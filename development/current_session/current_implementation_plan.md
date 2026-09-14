# Phase 5 — The Data window — Implementation Plan

Executes `current_design.md` (2026-09-13). Section references below (§4.2, §7.3 …)
point into that document; it is the spec, this is the order of operations.

**Baseline:** `dev` @ `7fe8944`. 293 tests / 26 files green, `typecheck` and
`build` clean. Phase 4 shipped `components/data-table/`, `components/domains/`
(contacts + files), and the three `record-*` window kinds — none of which any UI
can currently open.

---

## Global constraints

Carried from Phases 1–4, and they are not negotiable during this phase:

1. **Read `node_modules/next/dist/docs/` before writing anything Next-specific.**
   This is Next 16.2.6; conventions differ from training data (`client/AGENTS.md`).
2. **Vendored demos are references, never imports.** `components/data-table.tsx`
   and `components/settings-dialog.tsx` stay byte-identical. Generalised versions
   live in new files. (This is how Phase 4 produced `components/data-table/`.)
3. **Files under 500 lines.** `data-table.tsx` is at 359 and will grow; if an
   extension pushes it past ~450, split before continuing.
4. **Every file you touch gets its tests updated in the same task.** A task is not
   done with a red suite.
5. **`pnpm typecheck && pnpm test && pnpm build` at every gate.** Not at the end.
6. **No new runtime dependencies.** Everything needed is already in
   `package.json` — `swr`, `zustand`, `sonner`, `recharts`, `cmdk`, `date-fns`.
7. **Comment the load-bearing *why*, not the what.** Match the density of
   `use-domain-table.ts` and `workspace.store.ts`: every non-obvious decision in
   this plan has a rationale, and the rationale belongs in the code.
8. **Server data → SWR. Workspace memory → zustand. Table-local → `useState`.**
   (§5.) A fact that crosses those lines is a bug in the design, not a shortcut.

---

## Increment map

Four increments. Each ends with a working app and a gate that must pass before the
next begins.

| # | Name | Tasks | Ends with |
|---|---|---|---|
| **5a** | The shell | 1–8 | Contacts and Files reachable for the first time |
| **5b** | The data layer | 9–18 | Array endpoints, lookups, verb actions, row-level guards |
| **5c** | The domains | 19–25 | All seven domains live |
| **5d** | Record relations | 26–27 | Tabbed record windows |

Do not start a domain in 5c before 5b's gate passes. Five of the seven domains
need `useCollection`, four need `useLookup`, three need `deleteKey`, and building
them against stubs means rewriting them.

---

# Increment 5a — The shell

Goal: one `data` window whose sideNav routes between domains, rendering the two
configs that already exist. No new data-access code. When this lands, Phase 4's
work is reachable from the UI.

---

## Task 1: `patchWindowProps` on the workspace store

**Why:** navigation state lives in window props so it persists and deep-links for
free (§5.1), but `openWindow` writes props once and nothing can change them.

**File:** `stores/workspace.store.ts`

Add to the `WorkspaceState` interface and the `immer` body:

```ts
  /**
   * Merge a patch into one window's props.
   *
   * Navigation state (which domain, which section, which scope) lives in props
   * rather than a store of its own: props are already in the persisted slice,
   * so a reopened workspace lands back where it was, and
   * `openWindow({ kind: "data", props: { domain, section } })` is a deep link
   * with no extra machinery. See design §5.1.
   */
  patchWindowProps: (id: string, patch: JsonObject) => void
```

```ts
      patchWindowProps: (id, patch) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (!win) return
          // `__key` is the de-duplication identity `keyOf` reads. A patch that
          // dropped or overwrote it would orphan the window from its own
          // singleton slot, and the next openWindow would spawn a second one.
          const key = win.props?.__key
          win.props = { ...win.props, ...patch, ...(key === undefined ? {} : { __key: key }) }
        }),
```

**Must not** touch `zSeq` or `zIndex`. Changing a section is navigation, not
focus; raising the window over a modal on a tab click would be a bug.

**Tests** — `stores/workspace.store.test.ts`:
- merges into existing props, leaving untouched keys alone
- preserves `__key`, including when the patch tries to overwrite it
- does not change `zIndex` or `zSeq`
- a patch for an unknown id is a no-op, not a throw
- patched props survive a persist round-trip (extend the existing rehydrate test)

**File:** `features/workspace/use-window-controls.ts` — expose it:

```ts
  const patchProps = useWorkspaceStore((s) => s.patchWindowProps)
  // …
  patchProps: (patch: JsonObject) => patchProps(id, patch),
```

Update the doc comment: it says "the six per-window actions"; it is seven now.

**Done when:** store tests green, `patchProps` typed as `(patch: JsonObject) => void`.

---

## Task 2: Domain/section types and registry

**Why:** the one place a domain is added. Everything else in this phase reads it.

**File:** `components/data-window/types.ts` — verbatim from §4.1 of the design
(`DomainKey`, `SectionScope`, `SectionBody`, `SectionSpec`, `DomainSpec`).

**File:** `components/data-window/registry.ts`

```ts
import type { UserRole } from "@/lib/api/types"
import type { DomainKey, DomainSpec, SectionSpec } from "./types"

/**
 * Every domain, in sideNav order.
 *
 * Adding a domain is an entry here and a config file — never a window kind, a
 * registry entry and a dock chip. That is the whole point of one `data` window
 * (design §1).
 */
export const DOMAINS: DomainSpec[] = [
  /* 5a: contactsDomain, filesDomain.  5c adds the rest. */
]

/** Sections this principal may see. Role, not permission — see design §9. */
export function visibleSections(domain: DomainSpec, role?: UserRole): SectionSpec[] {
  return domain.sections.filter((s) => !s.roles || (role != null && s.roles.includes(role)))
}

export function visibleDomains(role?: UserRole): DomainSpec[] {
  return DOMAINS.filter(
    (d) => (!d.roles || (role != null && d.roles.includes(role))) && visibleSections(d, role).length > 0,
  )
}

/**
 * Resolve the persisted `{ domain, section }` hint to something renderable.
 *
 * These come out of localStorage, which `isRestorable` does not validate for
 * props (workspace.store.ts:101 — props are an untyped bag by design). A
 * retired domain key, a section whose `roles` no longer include this principal,
 * or a hand-edited value must degrade to the first visible thing, never to a
 * blank pane.
 */
export function resolveLocation(
  domainKey: unknown,
  sectionKey: unknown,
  role?: UserRole,
): { domain: DomainSpec; section: SectionSpec } | null {
  const domains = visibleDomains(role)
  if (domains.length === 0) return null
  const domain = domains.find((d) => d.key === domainKey) ?? domains[0]
  const sections = visibleSections(domain, role)
  const section = sections.find((s) => s.key === sectionKey) ?? sections[0]
  return { domain, section }
}
```

`resolveLocation` returning `null` is only reachable if a principal can see no
domain at all — `DataWindow` renders an `Empty` for it rather than crashing.

**Tests** — `components/data-window/registry.test.ts`:
- unknown domain key → first visible domain
- unknown section key → first *visible* section of that domain
- a section with `roles: ["admin"]` is absent for `role: "user"`, present for admin
- a domain whose every section is admin-only disappears entirely for a user
- `role: undefined` (principal still resolving) → only unrestricted sections
- `resolveLocation` never throws on `null`, `{}`, a number, or an empty string

---

## Task 3: `DomainNav`

**File:** `components/data-window/domain-nav.tsx`

Lifted from `settings-dialog.tsx:135-158` — `SidebarProvider className="items-start"`
+ `Sidebar collapsible="none"` + `SidebarContent/Group/GroupContent/Menu/MenuItem/
MenuButton`, with `isActive` on the current domain. Drop the demo's hard-coded
`data.nav` and its `href="#"` anchors: these are buttons, not links — there is no
route to navigate to, and an anchor here means a middle-click opens a blank page.

```tsx
<SidebarMenuButton isActive={d.key === active} onClick={() => onSelect(d.key)}>
  <d.icon />
  <span>{d.label}</span>
</SidebarMenuButton>
```

The active item gets `aria-current="page"`.

**Narrow fallback** (§10.2): below `md` the rail is `hidden md:flex` (the demo
already does this) and `DataWindow` renders a `Select` of domains in the header
instead. Same state, same handler, different control. Export both from this file:
`DomainNav` and `DomainSelect`.

**Tests** — `domain-nav.test.tsx`:
- renders one button per visible domain, in registry order
- clicking one calls `onSelect` with its key
- the active domain carries `aria-current="page"`
- admin-only domains absent for a `user` principal

---

## Task 4: `SectionTabs`

**File:** `components/data-window/section-tabs.tsx`

A Radix `Tabs`/`TabsList` of primary sections, plus a `DropdownMenu` trigger
(`⋯`, `aria-label="More sections"`) holding every `secondary: true` section.

Rules, all of which have a reason in §2:
- Primary sections in declaration order; secondary ones only in the overflow.
- When the **active** section is a secondary one, it is *also* rendered as a
  trigger in the `TabsList` (otherwise the tab row shows no selection and the
  user cannot see where they are).
- The overflow trigger is omitted entirely when no secondary sections exist.
- The list is `overflow-x-auto` with no visible scrollbar, so a 640px window
  still degrades rather than clipping.

**Tests** — `section-tabs.test.tsx`:
- primary sections rendered as tabs; secondary ones are not
- the overflow menu lists exactly the secondary sections
- choosing from the overflow calls `onSelect`
- an active secondary section appears in the tab row as well
- no `⋯` trigger when there are no secondary sections

---

## Task 5: `useRecordWindows`

**Why:** `contacts-window.tsx` hand-wrote four `openWindow` calls (§8.1).
Twenty-eight sections × four is the failure mode this phase exists to prevent.

**File:** `features/records/use-record-windows.ts`

```ts
"use client"

import { useMemo } from "react"
import { useWorkspace } from "@/features/workspace/use-workspace"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"

/**
 * The four DataTable handlers, derived from a config instead of typed out.
 *
 * `singletonKey` follows Phase 4's convention (`contacts:detail:<id>`) so a
 * second click on the same row focuses the open window rather than stacking a
 * duplicate — now generated rather than hand-written at each call site.
 */
export function useRecordWindows<T extends HasId>(
  config: DomainTableConfig<T>,
  /** Row → window title. Defaults to the row id, which is never a good title. */
  titleOf: (row: T) => string,
) {
  const { openWindow } = useWorkspace()
  const { key, endpoint, title } = config

  return useMemo(() => ({
    onOpen: (row: T) => openWindow({
      kind: "record-detail",
      title: titleOf(row),
      singletonKey: `${key}:detail:${row.id}`,
      props: { domain: key, endpoint, id: row.id },
    }),
    onCreate: () => openWindow({
      kind: "record-create",
      title: `New ${title.replace(/s$/, "").toLowerCase()}`,
      singletonKey: `${key}:create`,
      props: { domain: key, endpoint },
    }),
    onEdit: (row: T) => openWindow({
      kind: "record-edit",
      title: `Edit ${titleOf(row)}`,
      singletonKey: `${key}:edit:${row.id}`,
      props: { domain: key, endpoint, id: row.id },
    }),
    onDelete: (rows: T[]) => openWindow({
      kind: "confirm",
      title: rows.length === 1 ? `Delete ${title.toLowerCase()}` : `Delete ${title.toLowerCase()}`,
      singletonKey: `confirm:${key}:${rows.map((r) => r.id).join(",")}`,
      props: {
        message: `Delete ${rows.length} ${title.toLowerCase()}${rows.length === 1 ? "" : "s"}?`,
        confirmLabel: "Delete",
        destructive: true,
        // 5b replaces this with config.deleteKey — see Task 16.
        ids: rows.map((r) => r.id),
        endpoint,
      },
    }),
  }), [openWindow, key, endpoint, title, titleOf])
}
```

Note `props.domain` carries `config.key`, which is what `RECORD_FORMS` is keyed
on — the two key spaces must stay identical, so `config.key` is the single source.

**Tests** — `use-record-windows.test.tsx`: each handler opens the right kind with
the right `singletonKey`; calling `onOpen` twice for one row yields one window.

---

## Task 6: `SectionHost`

**File:** `components/data-window/section-host.tsx`

Dispatches on `SectionBody.kind`. For 5a only `"table"` is implemented; the other
three throw a typed exhaustiveness error so 5c cannot forget one.

```tsx
switch (body.kind) {
  case "table": {
    const nav = useRecordWindows(body.config, body.titleOf)
    return <DataTable config={body.config} {...nav} />
  }
  case "scoped-table":  // Task 22
  case "form":          // Task 25
  case "custom":        // Task 24
    return <NotYet kind={body.kind} />
}
```

(Hooks cannot be called inside a `switch` arm that may not run. Split each arm
into its own small component — `TableSection`, `ScopedTableSection`, … — and have
`SectionHost` render the right one. Do this from the start; retrofitting it after
`useRecordWindows` lands in a branch is a rules-of-hooks violation.)

**Mount keying** — the caller, not this component, supplies the key (§5.3):

```tsx
<SectionHost key={`${domain.key}:${section.key}:${scopeId ?? ""}`} … />
```

so a section switch unmounts the previous table and its page/search/filters/
selection reset. This is intended: a section is a different resource.

---

## Task 7: `DataWindow`

**File:** `components/data-window/data-window.tsx`

```tsx
export interface DataWindowProps {
  domain?: string
  section?: string
  /** Namespaced BY DOMAIN — `{ projects: { projectId: "…" } }`. A bare
   *  `{ projectId }` would leak the previous domain's choice into the next
   *  scoped section that happens to use the same param name. */
  scope?: Record<string, Record<string, string>>
  __windowId?: string
}
```

Behaviour:

1. `const { principal } = useSession()` → `resolveLocation(domain, section, principal?.role)`.
2. **Write the resolved location back** when it differs from the props, via
   `patchProps` — so a fallback becomes the persisted truth and the next reload
   does not re-resolve. Do this in an effect, not during render; a `set` during
   render on a store other component instances subscribe to is a side effect.
3. Layout: `SidebarProvider` (items-start) → `DomainNav` | `<main className="flex
   h-full min-h-0 flex-1 flex-col overflow-hidden">` → header (`Breadcrumb`:
   `Data › {domain} › {section}`, plus the scope picker slot from 5b) →
   `SectionTabs` → `SectionHost`.
4. **No `Dialog`, no fixed height.** `h-full min-h-0` throughout; `WindowFrame`
   owns the chrome (§2.1).
5. `<main tabIndex={-1}>` and focus it on section change (§10.3), so a
   screen-reader user is not left in the tab row while the content swaps.
6. `resolveLocation` → `null` renders an `Empty` ("Nothing here for this account").

Selecting a domain patches `{ domain, section: <its first visible section> }` in
one call — patching only the domain would leave a section key belonging to the
previous domain, which `resolveLocation` would then silently correct on the next
render. One patch, one truth.

**Tests** — `data-window.test.tsx`:
- renders the nav, the breadcrumb and the first domain's first section
- clicking a nav item patches props and swaps the pane
- an unknown persisted domain falls back and **writes the fallback back**
- switching section does not re-issue the previous section's request
- admin-only sections absent for a `user` principal

---

## Task 8: Wiring, retirement, and the test migration

**8a — declare the kind.**

`lib/windows/types.ts`: add `"data"` to `WindowKind`; delete `"contacts"` and
`"files"`.

`lib/windows/meta.ts`:
```ts
data: { kind: "data", title: "Data", icon: DatabaseIcon, singleton: true, modal: false,
        defaultRect: { w: 1140, h: 720 }, minSize: { w: 640, h: 420 } },
```
and remove the `contacts` / `files` entries.

`lib/windows/registry.tsx`: add the lazy `data` entry; remove `contacts` and
`files`.

**8b — the door.** `components/shell/shell-chrome.tsx`, beside Terminal:

```tsx
<Button variant="ghost" size="sm"
  className="h-7 gap-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
  onClick={() => openWindow({ kind: "data" })}>
  <DatabaseIcon className="size-3.5" /> Data
</Button>
```

**8c — `useOpenData`.** `data` is a singleton, so a second `openWindow` focuses
the existing instance and ignores the new props. Deep links need both:

```ts
// features/workspace/use-open-data.ts
export function useOpenData() {
  const { openWindow } = useWorkspace()
  const patch = useWorkspaceStore((s) => s.patchWindowProps)
  return useCallback((domain: DomainKey, section?: string) => {
    const id = openWindow({ kind: "data", props: { domain, ...(section ? { section } : {}) } })
    patch(id, { domain, ...(section ? { section } : {}) })
  }, [openWindow, patch])
}
```

This is how a notification, an agent turn or a future search result navigates
someone to a domain. Test it against an already-open window.

**8d — delete** `components/domains/contacts-window.tsx` and
`components/domains/files-window.tsx`. Keep both `.config.tsx` files; they become
sections. `files-window.tsx`'s `toolbarExtra: <FileDropzone />` and its Download
row action move into the Files section spec.

**8e — migrate the tests off the retired kinds.** This will otherwise light up
~20 assertions across eight files, and the executor will improvise.

`"contacts"` is used as an arbitrary **non-modal singleton** stand-in in:
`stores/workspace.store.test.ts` (11 sites), `features/state-hydration.test.tsx`
(2), `app/layout.test.tsx` (1), `lib/state/reset.test.ts` (1),
`features/workspace/use-workspace.test.tsx` (1),
`lib/state/legacy-storage.test.ts` (1).

Substitute `"data"` at every one. Verified safe: none of these assert on the
kind's `defaultRect` or `minSize` — the rect-specific tests use `confirm`, `auth`
and `terminal` (`workspace.store.test.ts:292-316`), and the viewport-clamp test
(`:278-281`) clamps whatever it is given.

`components/data-table/record-window.test.tsx:75` passes `domain="contacts"` — a
`RECORD_FORMS` key, **not** a window kind. Leave it.

**Gate 5a**

- [ ] `pnpm typecheck && pnpm test && pnpm build` clean
- [ ] Signed in, the Data button opens one window; clicking again focuses it
- [ ] Contacts renders live rows (282 across 15 pages, per Phase 4's verification)
- [ ] Files renders live rows and the dropzone
- [ ] Section switch resets page/selection; domain switch survives a reload
- [ ] Minimise → dock chip reads "Data"; restore returns to the same section

---

# Increment 5b — The data layer

Goal: every endpoint shape in §6.1 is renderable, reference ids resolve to
labels, verb endpoints are callable, and per-row guards work. No new domains.

---

## Task 9: `rowsOf` grows a `rows` branch

**File:** `lib/api/types.ts`

```ts
export interface Paginated<T> {
  data?: T[]
  /** file-processor's spelling of `data`. */
  items?: T[]
  /** finance's listBudgets spelling — returned straight from the repository
   *  (`finance.repository.ts:182-202`) with no page/limit echoed. */
  rows?: T[]
  total: number
  page?: number
  limit?: number
}

export function rowsOf<T>(p?: Paginated<T> | null): T[] {
  return p?.data ?? p?.items ?? p?.rows ?? []
}
```

`page` and `limit` become optional because `/finance/budgets` omits them. Safe:
`useDomainTable` reads neither back from the response — it uses `data?.total` and
`rowsOf(data)` only (`use-domain-table.ts:51,76`). **That is the entire Budgets
fix.** Confirm no other consumer reads `.page`/`.limit` before relaxing them.

**Tests** — `lib/api/types.test.ts`: `data`, `items`, `rows`, none, and
`data` winning when two are present.

---

## Task 10: New cache-key heads

**File:** `lib/swr/keys.ts`

```ts
  /** A bare-array endpoint. No query in the key: the whole collection is one
   *  cache entry, and filtering happens client-side (see useCollection). */
  collection: (endpoint: string) => ["collection", endpoint] as const,

  /** id → label options for reference columns and async filters. Separate from
   *  `collection` so a lookup's 100-row fetch never collides with a table
   *  showing the same endpoint at the user's chosen page size. */
  lookup: (endpoint: string) => ["lookup", endpoint] as const,

  /** A report is parameterised by a date range, so the params are in the key. */
  report: (path: string) => ["report", path] as const,
```

```ts
export const scopes = {
  allLists: (endpoint: string) => ["list", endpoint] as const,
  allRecords: (endpoint: string) => ["record", endpoint] as const,
  allCollections: (endpoint: string) => ["collection", endpoint] as const,
  allLookups: (endpoint: string) => ["lookup", endpoint] as const,
  conversations: () => ["conversations"] as const,
}
```

**File:** `lib/swr/fetcher.ts` — the switch is exhaustive and **throws by design**
("a fetcher that quietly resolves `undefined` … produces an empty list that looks
exactly like a legitimately empty domain"). Add:

```ts
      case "collection":
        return client.get(key[1] as string)
      case "lookup":
        // The DTOs cap `limit` at 100. Past that, useLookup degrades to short
        // ids rather than silently labelling only the first page (§6.3).
        return client.get(`${key[1] as string}?limit=100`)
      case "report":
        return client.get(key[1] as string)
```

A `lookup` against a bare-array endpoint (`/finance/accounts`) receives an
unknown `?limit` query param, which every list DTO ignores. Harmless, and it
keeps one code path.

**Tests** — extend `keys.test.ts` and `fetcher.test.ts`: each new head hits the
expected path; an unknown head still throws.

---

## Task 11: The collection pipeline (pure)

**Why:** extracted from the hook so it can be tested without a harness, exactly
as `buildListUrl` was — "the ways this goes wrong are silent".

**File:** `components/data-table/collection-query.ts`

```ts
/**
 * Apply a TableQuery to an in-memory array: tab params, then filters, then
 * search, then sort, then the page slice — in that order, matching what the
 * server does for paged endpoints so the two sources behave identically.
 *
 * Client-side is correct HERE and nowhere else: these are bounded sets —
 * accounts, categories, milestones, preference rows — tens of items. The 282
 * contacts that forced server paging do not come through this path.
 */
export function applyCollectionQuery<T extends HasId>(
  rows: T[],
  query: TableQuery,
  config: DomainTableConfig<T>,
): { rows: T[]; total: number }
```

Semantics to pin down in tests:
- tab `query` params and `filters` both match a row field by **string equality**
  against `String(row[key])`; an absent field never matches a non-empty filter
- search is a case-insensitive substring over the **string-valued fields named by
  the columns' `key`s**, not over rendered cells (a cell returns a ReactNode)
- `total` is the count **after** filtering and **before** the page slice
- an out-of-range page yields an empty array, not the last page — `clampPage`
  already handles correction at the call site and doing it twice hides bugs
- sort compares with `localeCompare` for strings and numerically when both sides
  parse as finite numbers, `undefined`/`null` last in both directions

**Tests** — `collection-query.test.ts`, one per bullet.

---

## Task 12: `useCollection` and the `useDomainTable` dispatcher

**File:** `features/records/use-collection.ts`

```ts
export function useCollection<T extends HasId>(
  config: DomainTableConfig<T>,
  enabled: boolean,
): DomainTable<T>
```

- `useSWR<T[]>(enabled ? keys.collection(config.endpoint) : null)`
- query state identical to `useDomainTable`'s (`initialQuery(config.tabs)`,
  same `setQuery` page-reset rule, same `setFilter`)
- `refresh` invalidates `scopes.allCollections(endpoint)`
- **no `keepPreviousData`** — paging is a `useMemo` over data already in hand, so
  there is no fetch to be laggy about
- returns the same `DomainTable<T>` interface, so `DataTable` never learns which
  kind of endpoint it is rendering
- a response that is not an array (a backend change, an error page) resolves to
  `status: "error"` with "Unexpected response shape", not to an empty table

**File:** `features/records/use-domain-table.ts` — becomes the dispatcher. Rename
the existing body to `usePagedTable(config, enabled)` (same file or a sibling),
then:

```ts
export function useDomainTable<T extends HasId>(config: DomainTableConfig<T>): DomainTable<T> {
  const isCollection = config.source === "collection"
  // Both hooks always run — hooks cannot be called conditionally. The inactive
  // one is keyed null, so it holds no cache entry and issues no request.
  const paged = usePagedTable(config, !isCollection)
  const collection = useCollection(config, isCollection)
  return isCollection ? collection : paged
}
```

`usePagedTable` gains the `enabled` parameter: `useSWR(enabled ? keys.list(…) : null, …)`.

**Tests** — `use-collection.test.tsx` and an addition to
`use-domain-table.test.tsx`:
- a `collection` config fetches once and pages in memory
- the inactive branch issues **no** request (assert `fetchImpl` call count)
- `refresh` on a collection invalidates and refetches
- a non-array response surfaces as an error

---

## Task 13: `useLookup`

**File:** `features/records/use-lookup.ts`

```ts
export interface Lookup {
  /** Label for an id, or "—" for null, or a short id when unresolved. */
  label: (id: string | null | undefined) => string
  options: { value: string; label: string }[]
  isLoading: boolean
  /** True when the source has more rows than one page could carry, so `label`
   *  may be degrading to short ids. Callers surface this, never hide it. */
  truncated: boolean
}

export function useLookup(endpoint: string, labelKey = "name"): Lookup
```

- one `useSWR(keys.lookup(endpoint))` per endpoint, shared by every consumer — the
  Account column, the Account filter and the Account form field are one request
- accepts both envelope shapes: `Array.isArray(data) ? data : rowsOf(data)`
- `truncated` when `total != null && total > rows.length`
- unresolved id → `id.slice(0, 8)` with the full id as a `title` attribute at the
  call site. Honest degradation; a wrong label is worse than a short one.
- while loading, callers render a `Skeleton` sized to the column — never a flash
  of raw UUID

**Tests** — `use-lookup.test.tsx`: labels resolve; two consumers share one
request; unknown id degrades; `truncated` set when `total` exceeds the page;
array and enveloped responses both work.

---

## Task 14: `ScopePicker`

**Why:** `/projects/:id/milestones` has no unscoped form. Without a parent there
is nothing to request (§7.5).

**File:** `components/data-window/scope-picker.tsx`

A `Combobox` over `useLookup(scope.from, scope.labelKey).options`, rendered in the
pane header. Emits the chosen id to `DataWindow`, which patches
`props.scope = { ...scope, [domain.key]: { [scope.param]: id } }` — namespaced by
domain, per Task 7.

`ScopedTableSection` (in `section-host.tsx`):
- **no scope chosen → render `Empty`** ("Choose a project to see its milestones")
  and **issue no request**. Not an error, not a blank table.
- scope chosen → `body.config(parentId)` builds the config, and the mount key
  includes the id so changing projects remounts.
- breadcrumb gains a fourth crumb: `Data › Projects › Milestones › ACME`.

**Tests** — `scope-picker.test.tsx` + a `section-host` case: no request before a
choice; choosing patches props and fetches; changing the choice refetches.

---

## Task 15: Config extensions

**File:** `components/data-table/types.ts` — apply §4.2 verbatim, plus one field
the design added later in §7.4:

```ts
  /** Checkbox column and bulk actions. False for tables nothing bulk-acts on
   *  (notification preferences: there is no "delete 3 preferences"). */
  selectable?: boolean   // default true
```

All additions are optional, so every existing config still compiles.

**File:** `components/data-table/data-table.tsx` — honour them:

- `source` — nothing to do here; `useDomainTable` dispatches.
- `selectable: false` — drop the header and body checkbox cells and the bulk
  Delete button. Adjust the `colSpan` on the empty/error row (currently
  `columns.length + (showActions ? 2 : 1)`); getting this wrong renders a
  half-width empty state.
- **row-level guards** — resolve per row:
  ```ts
  const can = (g: boolean | ((r: T) => boolean) | undefined, row: T) =>
    typeof g === "function" ? g(row) : Boolean(g)
  ```
  `RowMenu` hides Edit/Delete when the guard fails for that row. This matches the
  existing rule the file already states: *"Actions the user cannot perform are
  hidden, not disabled."*
- **bulk delete** — enabled only when every selected row passes `canDelete`. When
  some pass and some do not, the button reads `Delete 3 of 5` and acts on the
  eligible subset. Silently deleting fewer than the count on the button is the
  failure to avoid.
- `numeric` columns — `className` gains `text-right tabular-nums` (merge with any
  `className` the spec already carries, via `cn`).
- `defaultSort` — seeded into `initialQuery`.

**File:** `components/data-table/async-filter.tsx` — a `FilterSpec` with `source`
renders a `Select` (or `Combobox` when `searchable`) whose options come from
`useLookup(source.endpoint, source.labelKey)`. Loading shows a disabled trigger
with a `Skeleton`; a failed option fetch leaves the filter disabled with a
tooltip rather than an empty dropdown that looks like "no options exist".

**Tests** — extend `data-table.test.tsx`:
- `selectable: false` renders no checkboxes and the empty row spans the full width
- `canEdit: (r) => r.id === "1"` shows Edit on row 1 only
- mixed-eligibility bulk delete reads "Delete 1 of 2" and calls back with one row
- `numeric` column is right-aligned
- an async filter renders its fetched options

---

## Task 16: Delete by path key

**Why:** three endpoints delete by something other than the row id —
`…/suppressions/:email`, `/projects/:id/members/:userId`, `/me/preferences/:key`.

- `config.deleteKey?: (row: T) => string` (Task 15) is applied in
  `useRecordWindows.onDelete`: `ids: rows.map(config.deleteKey ?? ((r) => r.id))`.
- `ConfirmWindow` needs no change — it already takes `ids: string[]` and issues
  `DELETE ${endpoint}/${id}` per id. Update its prop doc to say "path keys, which
  are row ids unless the domain says otherwise", and widen the `singletonKey`
  composition in `useRecordWindows` to use the same keys so two different
  selections cannot collide.

**Tests** — `use-record-windows.test.tsx`: a config with `deleteKey` passes emails,
not ids; `confirm-window.test.tsx` unchanged and still green.

---

## Task 17: Write helpers

**File:** `features/records/use-singleton-record.ts`

```ts
/** A resource of one: `GET /me/profile`, `PATCH /me/profile`. `useRecordMutations`
 *  composes `${endpoint}/${id}`, which is wrong when there is no id. */
export function useSingletonRecord<T>(endpoint: string): {
  record: T | null
  isLoading: boolean
  error: unknown
  save: (body: unknown) => Promise<void>
}
```
`save` PATCHes and invalidates `scopes.allRecords(endpoint)` **and**
`keys.record(endpoint, "")` — pick one key shape and use it consistently; simplest
is `keys.collection(endpoint)` since a singleton has no id either.

**File:** `features/records/use-row-action.ts`

```ts
/**
 * A verb endpoint as a row action.
 *
 * Finance and Knowledge expose state changes as POSTs, not fields:
 *   POST /finance/transactions/:id/status/:status
 *   POST /knowledge/:id/status            { status, note }
 *   POST /invoices/:id/issue | /void | /payments
 * A form that PATCHed `status` would be lying about what the server accepts —
 * knowledge.service enforces a transition table and ledger.service guards
 * status moves with FOR UPDATE.
 */
export function useRowAction(endpoint: string): {
  run: (path: string, body?: unknown) => Promise<void>
  pending: string | null
  error: string | null
}
```
`run` POSTs, then invalidates `allLists` + `allRecords` + `allCollections` for the
endpoint, then toasts success via `sonner` (`Toaster` is already mounted in
`app/layout.tsx:37`). Failure returns the `ApiError` message to the caller for
inline display — a toast that vanishes is not an error report.

**File:** `features/records/use-cell-mutation.ts`

```ts
/** In-cell edits (a Switch, a Select) with optimistic update and rollback. */
export function useCellMutation<T>(key: readonly unknown[], endpoint: string): {
  write: (method: "put" | "patch", path: string, body: unknown, optimistic: (rows: T[]) => T[]) => Promise<void>
  saving: Set<string>
}
```
`mutate(key, optimistic, { revalidate: false })` → request → on success revalidate,
on failure restore the snapshot and toast. Keep the failed row visibly marked
until the user acts; silently reverting a switch is how a user concludes the
setting "didn't stick" without knowing why.

**Tests** — one file each: success path, failure path (rollback + message), and
that the right scopes are invalidated.

---

## Task 18: `RecordForm` extraction and the `seed` escape hatch

**Why:** `/me/profile` is a form with no window, and `/notifications` rows have no
`GET /notifications/:id` to fetch.

**File:** `components/data-table/record-form.tsx` (new) — lift the field rendering,
`values` state, validation and the save/cancel footer out of `record-window.tsx`
into `<RecordForm spec values onChange onSave onCancel readOnly error saving />`,
a **controlled, presentational** component. Move `RecordField` with it.

`record-window.tsx` keeps: `useRecord`, `useRecordMutations`, the one-shot seeding
logic (its long comment about *not* re-seeding on cache invalidation is
load-bearing — carry it across verbatim), and `close`.

Add to `RecordWindowProps`:
```ts
  /** Render from a row already in hand instead of fetching. For domains with a
   *  list endpoint but no item endpoint — /notifications is the case. Without
   *  it, clicking a notification row 404s. */
  seed?: Record<string, unknown>
```
When `seed` is present, `useRecord` is called with `undefined` id (so it stays
idle) and `seed` takes the place of `record` in the seeding branch.

**Tests** — `record-window.test.tsx` keeps passing unchanged (the refactor is
behaviour-preserving; that is the proof). Add: a `seed`ed window renders fields
and issues no request. New `record-form.test.tsx` for the presentational piece.

**Gate 5b**

- [ ] `pnpm typecheck && pnpm test && pnpm build` clean
- [ ] `data-table.tsx` still under 500 lines (split if not)
- [ ] A throwaway `collection` config against `/finance/accounts` renders live rows
- [ ] A throwaway `useLookup("/projects")` resolves a task's `projectId` to a name
- [ ] No existing Phase-4 test was weakened to make a new one pass

---

# Increment 5c — The domains

One config file per domain, one registry entry each. Order is by increasing
interaction novelty, so each domain introduces at most one new idea.

---

## Task 19: Shared cells

**File:** `components/domains/cells.tsx`

| Export | Notes |
|---|---|
| `Dash` | the `—` for nulls; lifted from `contacts.config.tsx:39` and deduplicated |
| `StatusBadge` | `(value, map)` → `Badge` with variant + human label |
| `PriorityBadge` | low/medium/high/urgent |
| `Money` | **formats from the decimal string, never via `Number`** |
| `DateCell` / `RelativeTime` | `date-fns`; `YYYY-MM-DD` date columns are not timestamps and must not be shifted by a timezone |
| `Duration` | `minutes → "2h 30m"` |
| `ProgressCell` | `Progress` + `%`, amber at a threshold, red past 100 |
| `LookupCell` | id → label via `useLookup`, `Skeleton` while loading, short id + `title` when unresolved |

`Money` is the one worth a test of its own: amounts are `numeric(20,4)` decimal
strings (`money.util.ts` — *"never a float"*), and a `Number()` round-trip on
`"12345678901234.5678"` loses precision silently. Format the integer and
fractional parts as strings via `Intl.NumberFormat` on the parts, or pass the
string to `Intl.NumberFormat` where the runtime supports it — and test the
16-digit case.

---

## Task 20: Contacts (§7.1)

Four sections: People, Companies, Types ˢ, Categories ˢ.

- **People** — extend the existing `contactsConfig`: add the Company column and
  the four filters `listContactsSchema` already accepts and nothing exposed
  (`companyId`, `typeId`, `categoryId`, `tagId` — all async, `companyId` and
  `tagId` searchable).
- **Companies** — `/companies`, paged. Form from `createCompanySchema`.
- **Types / Categories** — `/contact-vocabulary/*`, **collection**. `key` is
  `createOnly` (the update schemas omit it — it is immutable once set).
  Categories indent by `depth` and default-sort by `path`, so the materialised-path
  tree reads as a tree inside a flat table.
- `RECORD_FORMS` gains `companies`, `contact-types`, `contact-categories`.

**First domain, so also:** prove the registry entry shape end to end and keep the
Phase-4 Contacts behaviour byte-identical where it is not deliberately extended.

---

## Task 21: Knowledge (§7.3)

Three sections: Articles, Types ˢ, Categories ˢ. Three new ideas, all in Articles:

1. **Status is read-only in the form.** Transitions go through
   `POST /knowledge/:id/status` and the service enforces a transition table
   (`knowledge.service.ts`, `TRANSITIONS`). Mirror that table client-side so the
   row menu offers only the legal moves from the row's current status, each
   prompting for the optional `note`. A `status` `Select` in the edit form would
   promise transitions the server rejects.
2. **Optimistic concurrency.** Capture `version` at load, send `expectedVersion`
   on save, and render a **conflict** state on 409: *"This was changed by someone
   else — reload to see the current version"* with a Reload that invalidates
   `allRecords`. Not a generic error toast: last-write-wins here loses a
   colleague's edit silently.
3. **`total` is post-ACL.** `knowledge.service.ts:185-190` pages in SQL, filters
   by resolved access, then returns `total: visible.length` beside
   `totalBeforeAccess`. Show `total` in the pager and, when
   `totalBeforeAccess > total`, a muted footnote: *"N records on this page are
   not visible to you."* The `Paginated<T>` type gains an optional
   `totalBeforeAccess?: number`.

Per-row guards from `access`: `canEdit: (r) => r.access === "write" || r.access === "manage"`,
`canDelete: (r) => r.access === "manage"`.

---

## Task 22: Projects (§7.5)

Six sections, and the first scoped ones — Task 14's `ScopePicker` gets its real
use here.

- **Projects** — paged. `progressPct` → `ProgressCell`. `access` drives
  `canEdit`/`canDelete` (`manager|owner` / `owner`). `key` is `createOnly`,
  validated `^[A-Z][A-Z0-9_]*$` client-side. `ownerUserId` appears **only** on
  the update form — ownership moves through `PATCH /projects/:id` alone, by
  design (`project.dto.ts:22-31`).
- **Tasks** — paged. The Ref column composes `{projectKey}-{number}` from the
  `/projects` lookup; the row carries only `projectId` and `number`. Row actions
  Move / Log time / Watch. **The Move dialog asks for `blockedReason` when the
  target status is `blocked`** — the service requires it, the DTO does not say so
  (`task.dto.ts:57`).
- **Time** — paged, `endpoint: "/tasks/time"` (item paths are
  `/tasks/time/:entryId`, so the generic `${endpoint}/${id}` is correct).
  `canEdit: (r) => !r.invoiceLineItemId` — the FK is the "already billed" lock.
  The form must not offer `taskId`/`projectId`; `updateTimeSchema` excludes them
  deliberately.
- **Milestones / Goals** — scoped collections. Goals indent key results under
  their objective via `parentGoalId`, and the create form enforces the DTO's
  `superRefine` (a key result needs a parent; an objective must not have one).
  Write paths for milestones are **unscoped**: `PATCH|DELETE /projects/milestones/:id`.
- **Members** ˢ — scoped collection. `deleteKey: (r) => r.userId`. The role select
  offers `manager|contributor|viewer` only — `owner` is absent from
  `ASSIGNABLE_MEMBER_ROLES` to prevent the escalation that comment documents, and
  offering it here would reintroduce it.

---

## Task 23: Notifications (§7.4)

Five sections, four of them new shapes.

- **Inbox** — paged, **read-only, no search, no filters, no view tabs**.
  `listNotificationsSchema` accepts `page` and `limit` and nothing else; offering
  controls the API ignores is worse than not having them (the call
  `files.config.tsx:46-48` already makes). Row click opens a `seed`ed detail
  window (Task 18) — there is no `GET /notifications/:id`.
  **Do not draw an unread badge.** `status` is a delivery state, not a read
  receipt; there is nothing to compute one from.
- **Preferences** — the interactive-cell table. `Switch` for `enabled`, `Select`
  for `frequency`, two hour selects for quiet hours, each writing the **whole**
  object through `PUT /notifications/preferences` (an upsert keyed on `eventKey`,
  not a PATCH). `selectable: false`. `isMandatory` rows render the switch checked
  **and disabled** with a tooltip — mirroring the 403
  (`notification-admin.service.ts:99-104`), and consistent with the file's own
  rule that a permanently disabled control is noise.
- **Templates ˢ**, **Event types ˢ** — admin, collection.
- **Suppressions ˢ** — admin, `collection` with the `?limit=100` caveat: the
  endpoint takes `page`/`limit`, slices server-side, and returns a naked array
  **with no total** (`notification.repository.ts:471-482`). Request 100; when
  exactly 100 come back the footer reads *"Showing the first 100 — there may be
  more"*. Reporting a total the response does not contain is precisely how Phase
  4's `/files` bug looked from the outside. `deleteKey: (r) => r.email`.

---

## Task 24: Finance (§7.2)

Eight sections — the densest domain, and the only one with a non-table pane.

- **Transactions** — `canEdit: false`, `canDelete: false`. Neither PATCH nor
  DELETE exists; corrections are reversing entries by design. Row actions are the
  legal status moves plus **Reverse…** (confirm, destructive). Amounts via `Money`,
  signed by `kind` — the column carries no sign of its own.
- **Invoices** — create + verbs (Add line / Bill time / Issue / Record payment /
  Void), each visible only where the status allows. `GET /invoices/:id` returns
  `{ …invoice, lineItems, payments }`, so this is the natural pilot for 5d.
- **Budgets** — the `rows` envelope (Task 9 makes it work). `ProgressCell` tinted
  at `alertThresholdPct`. "At risk only" is a **toolbar toggle that swaps the
  config's endpoint** to `/finance/budgets/at-risk`, not a view tab — a view tab
  changes a query param, and this changes the path.
- **Accounts** — collection, create only. Row action **Reconcile**.
- **Recurring** — collection, create + delete + **Materialize due** (confirm: it
  writes ledger rows). The endpoint is `list(activeOnly = true)` with no
  parameter, so **inactive schedules are invisible** — the empty state and the
  Active column both say so rather than implying completeness.
- **Reports** — `SectionBody.kind: "custom"`. Date range + `projectId` over
  `/finance/reports/{summary,income-by-category,spend-by-category,forecast}`:
  four figures, two breakdown tables with inline bars, one area chart
  (`components/ui/chart.tsx`). A report is an aggregate, not a row set; forcing
  it into `DataTable` means a table with no id, no selection and no pager.
- **Categories ˢ** — read-only (the repository has `createCategory`; no route
  reaches it). **FX rates ˢ** — create is an **upsert** on `(base, quote, asOf)`,
  and the form says so.

---

## Task 25: You (§7.7)

Four sections; three are not tables. This is where `SectionBody.kind: "form"` and
`"custom"` get their implementations.

- **Profile** — `GET|PATCH /me/profile` via `useSingletonRecord` + `RecordForm`.
  `timezone` is a `Select` over `Intl.supportedValuesOf("timeZone")`, not free
  text: the notification scheduler reads it for quiet hours, and a typo there
  breaks delivery silently.
- **Preferences** — collection; the value control follows the declared `type`
  (`string|number|boolean|json`), and `setPreferenceSchema`'s `superRefine`
  (value must match type) is mirrored so a bad JSON blob fails before the
  request. `deleteKey: (r) => r.key`.
- **Account** — `custom`: a read-only card from `useSession().principal`, plus
  **Change password** (`PATCH /auth/password`, rules already in `lib/api/types.ts`
  as `PASSWORD_MIN_LENGTH`/`PASSWORD_MAX_LENGTH`) and **Sign out** (`useSignOut`).
- **Users ˢ** — admin, paged. The edit form warns that changing a role revokes
  that user's sessions and cached permissions (`users.service` calls
  `SessionRevocationService`).

**Gate 5c**

- [ ] `pnpm typecheck && pnpm test && pnpm build` clean
- [ ] Every section in §7 renders against the live API while signed in as admin
- [ ] Repeat the sweep as a non-admin: admin sections absent, not 403-ing
- [ ] Every envelope in §6.1 confirmed against a real response, not a fixture
- [ ] One create, one edit and one delete performed for real per writable domain
      — Phase 4 shipped these untested against live data and said so

---

# Increment 5d — Record relations

## Task 26: `RecordFormSpec.relations`

```ts
  /** Per-record collections, rendered as tabs beside Details. */
  relations?: {
    key: string
    label: string
    endpoint: (recordId: string) => string
    config: DomainTableConfig<never>
  }[]
```

When present, `RecordWindow` renders `Tabs`: *Details* + one per relation, each a
small `DataTable`. Same rule as §2, one level down. Mount-key each relation tab so
only the active one fetches.

## Task 27: Roll out

Invoice detail first (lines + payments — the data already arrives in one response,
so it is the cheapest proof). Then contact channels/relationships/interactions,
knowledge grants/contacts, task dependencies/watchers, project knowledge/contact
links.

**Gate 5d** — as above, plus: a relation tab issues no request until selected.

---

## Risk register

| Risk | Signal | Response |
|---|---|---|
| An envelope in §6.1 is wrong | A table shows "N rows" over an empty body | Phase 4's exact bug. Verify each against a live response at the 5c gate, not against a fixture — every fixture will agree with whatever the code expects. |
| `data-table.tsx` outgrows 500 lines | Task 15 adds four behaviours | Split `RowMenu` and the toolbar into siblings before adding the fifth. |
| Test migration (8e) misses a site | ~20 red assertions at the 5a gate | Grep `kind: "contacts"` and `kind: "files"` across `**/*.test.*` before starting, not after. |
| Section switching feels laggy | Remount refetches inside `dedupingInterval` | Expected and cheap; SWR paints from cache. If it is not, the key is being rebuilt per render — check the `useMemo` on the config. |
| `useLookup` truncation is silently hidden | A column shows short ids on a large tenant | `truncated` must be surfaced by every consumer. Assert it in the cell test. |
| Scope state leaks between domains | Milestones opens on the previous domain's project | `props.scope` is namespaced per domain: `scope: { projects: { projectId } }`, not a bare `projectId`. |

---

## Carried forward — backend asks (design §14)

Not blocking; each has a workaround above, and each costs client code it should
not. Raise as backend issues in parallel with 5b:

1. Four spellings of "the rows" (`data` / `items` / `rows` / naked sliced array).
   The suppressions case is a correctness bug on the backend's own terms — it
   takes a `page` parameter it gives the caller no way to use.
2. `GET /me/permissions` — no principal can read their own effective permissions
   today, so `DomainTableConfig.permissions` cannot be enforced (§9).
3. Batch label resolution (`?ids=`), so `useLookup` stops fetching 100 rows.
4. `GET /notifications/:id`.
5. A read receipt on notifications.
6. `GET /finance/recurring?activeOnly=false` — the service takes the parameter,
   the controller never passes it.
7. Unscoped `GET /milestones?projectId=` and `/goals?projectId=` — `listGoals`
   already accepts a null project internally.

---

# Phase 5 outcome (2026-09-14)

**Increments 5a–5d complete.** 732 tests across 59 files (from 377/45),
`typecheck` clean, `build` clean, `lint` unchanged from baseline (43 problems,
all pre-existing in vendored `ai-elements` / `ui` / `system-core` files — the
new code adds none). Every new file is under the 500-line limit.

**Not verified: anything against a live API.** No server or credentials were
available in this session, so every envelope in §6.1, every verb endpoint and
every write path is covered by unit tests against fixtures only. Phase 4's
`/files` bug is the precedent for why that is not enough — see "Still not
verified" below.

## What landed

`components/data-window/` (shell, nav, section tabs, section host, scope
picker, registry), `components/domains/` (seven domain configs, their action
modules, shared cells, relation configs, the finance reports pane),
`components/data-table/record-forms/` (seven spec files behind one index),
`features/records/` (collection, lookup, report, row-action, cell-mutation,
singleton-record, record-windows). `data` replaces the `contacts` and `files`
window kinds; the Data button in `ShellChrome` is the first thing that has
ever opened either.

Seven domains, 28 table sections, 7 record-relation tabs, 27 form specs.

## Deviations from the plan

- **`record-forms.ts` was split into a directory.** The plan had one file; it
  passed 500 lines with three domains in it, so it became an index over
  `record-forms/*.forms.ts`. Finance alone has nine specs.
- **`finance.config.tsx` and `projects.config.tsx` each shed their row types**
  into `*.types.ts` for the same reason, which also broke an import cycle:
  the action modules need a row type and are themselves imported by the
  configs.
- **Two seams the plan did not anticipate**, both forced by real endpoints:
  - `SectionBody.useExtras` — a config is otherwise a static object, but the
    Files dropzone is bound to upload state and its Download action to the
    API client. Rather than make all seven domains author a hook, sections
    declare an optional one.
  - `SectionBody.wrapper` — notification and user preferences are edited in
    the cell, and every cell needs the *same* `useCellMutation` instance or
    two in-flight edits each hold their own cache snapshot and one rollback
    clobbers the other. A `cell()` callback cannot call hooks, so the table
    is wrapped in a provider.
- **`DomainTableConfig.rowId`** was added late: `/notifications/preferences`
  composes its rows from event types and saved settings and returns no `id`
  at all, so the table rendered every row under `key={undefined}`.
- **`ConfirmWindow` gained `postTo`/`body`.** Eight verbs across Finance and
  Projects are "confirm, then POST" — void, reverse, issue, materialize,
  block. The dialog was delete-only.
- **`useRecordWindows` withholds handlers rather than always supplying four.**
  See the bug below.

## Two bugs the tests caught

**Every relation tab offered "New" with no form behind it.** Seven of them —
channels, relationships, interactions, grants, dependencies, lines, payments.
Clicking New opened a window reading *"No form is configured for
contact-channels"*. Caught by extending `domains.contract.test.ts` to walk
relation configs, not by rendering anything.

**Clicking a Files row opened the same dead end.** Phase 4's
`files-window.tsx` passed only `onDelete`; the generic `useRecordWindows`
supplies all four handlers, and Files has no form spec because it has no
create and no edit. `useRecordWindows` now returns `undefined` for
open/create/edit when `RECORD_FORMS[key]` is absent, and a test pins it.

Both are the same class of defect — a control that can only ever fail — and
neither throws, so neither would have surfaced without the contract test.

## One lint rule that earned its keep

`no-restricted-imports` rejected `useSWR` in `finance-reports.tsx` and
`useApi` in `profile-actions.tsx`: **UI components consume `features/**`, not
SWR or the API client directly.** Fixed by adding `features/records/use-report.ts`
and `features/session/use-change-password.ts` rather than suppressing the
rule — which is how the password rules ended up mirrored in one place instead
of inline in a card component.

## Decisions worth recording

- **Three navigation levels, kept spatially apart.** sideNav = domain,
  pane-header tabs = schema, table-toolbar tabs = saved filter. The third
  already existed as `DomainTableConfig.tabs`; building sections on the same
  field would have collapsed two different meanings into one.
- **The vendored `settings-dialog.tsx` was generalised, not imported** — the
  same move Phase 4 made with `data-table.tsx`. Its `Dialog` wrapper is
  dropped because `WindowFrame` already renders `role="dialog"`; nesting them
  is two focus traps in one box.
- **Only the active section is mounted.** Twenty-eight sections rendered
  eagerly would be twenty-eight requests to open one window. The mount key is
  `domain:section:scope`, so a section switch resets page, filters and
  selection — intended, since a section is a different resource.
- **Navigation state lives in window props**, not a new store: props are
  already in the persisted slice, so a reload lands back where it was and a
  deep link is `openWindow({ props })` with no extra machinery.
- **Per-row `canEdit`/`canDelete`.** `PublicProject.access` and
  `PublicKnowledge.access` are the server telling the client what this
  principal may do to *this* row. A viewer is not shown Edit; a time entry
  already on an invoice is not editable at all.
- **Verbs are row actions, never form fields.** Knowledge status moves
  through a transition table; transactions have no PATCH at all. A `status`
  select would advertise transitions the server rejects.
- **Money never round-trips through `Number`.** `formatAmount` groups the
  integer part with `Intl` and appends the fraction as text; the 16-digit
  case is pinned by a test. `subtract` (invoice balance) uses BigInt units.
- **Dates are split, not parsed.** A `YYYY-MM-DD` column through `new Date()`
  renders as the previous day west of Greenwich — an invoice dated the 1st
  reading as the 31st.

## Verified against the live API (2026-09-14, localhost:3000)

Signed in as `admin@cybernetics.local` against a populated database — 290
contacts, 413 transactions, 186 knowledge articles, 623 users. Two sweeps:
every list endpoint's envelope and first-row keys, then a create → read →
edit → delete cycle per writable domain. **All probe data was removed; a
leftover check reports zero.**

**Confirmed as designed.** All five envelope shapes (`data` ×11, `items` for
`/files`, `rows` for `/finance/budgets`, bare arrays ×15, and suppressions'
sliced-array-with-no-total). Every `source: "collection"` assignment. Full
CRUD on contacts, companies, knowledge, projects, tasks and the vocabularies.
The knowledge transition table — `in_review → published → archived` all 201,
and `archived → in_review` correctly 409s with *"Cannot move from archived to
in_review"*. The mandatory-notification guard 403s with the exact message the
UI mirrors. A type-mismatched preference 400s. `PATCH /me/profile` works with
no id in the path.

**Five defects live data exposed, all now fixed:**

1. **Knowledge's pager was wrong by two orders of magnitude.** `total` is the
   visible count *on this page*, capped by `limit` — `?limit=20` answers
   `total: 20, totalBeforeAccess: 186` on every page. The pager divided by
   `total` and read "Page 1 of 1" for 186 records, stranding 166 of them.
   `usePagedTable` now pages by `totalBeforeAccess` and derives
   `hiddenOnPage` exactly (a short *non-final* page is filtered; a short
   final page is just the end).
2. **Eleven endpoints have a list route and no `GET /:id`** — all four
   vocabularies, budgets, accounts, recurring, fx-rates, suppressions, time
   entries, project members. Every record window opened against one 404s on
   load. `DomainTableConfig.noItemEndpoint` now seeds those windows from the
   row in hand, which also subsumes the bespoke action Notifications needed.
3. **`GET /invoices/:id` nests the record** — it returns
   `{ invoice, lineItems, payments }`, not a spread, so the detail form read
   `record.number` off the wrapper and rendered blank.
   `RecordFormSpec.unwrap` fixes it.
4. **`GET /invoices/:id/lines` and `/payments` do not exist** — both 404. The
   only way to read either is the parent response. Added
   `source: "inline"`, so a relation tab can take its rows from the record
   already loaded instead of a route that isn't there.
5. **Two columns read fields that do not exist.** Suppressions carry
   `eventTypeId`, not `eventKey` (now resolved through a lookup), and tags
   carry `label`, not `name` — so both tag filters would have shown short
   ids instead of tag names.

Items 2–5 are the same failure mode as Phase 4's `/files` bug and share its
cause: a fixture agrees with whatever the code expects.

## Still not verified

- **The ledger verbs** — status moves, reverse, void, issue, record payment,
  materialize. Deliberately skipped: a transaction has no DELETE, so testing
  them writes permanent rows into a populated finance database. The routes
  are confirmed present in the controllers; the request/response contract is
  not confirmed.
- **Scoped sections with real data** — this database has no milestones or
  goals on the project sampled, and no contact channels, relationships,
  interactions or knowledge grants. The list routes answer 200 with `[]`, so
  the shape is confirmed and the column mappings are not.
- **The notifications inbox** — zero rows, so neither the row shape nor the
  absent `GET /notifications/:id` could be exercised. Route absence is
  confirmed from the controller source.
- **In-browser rendering.** Everything above is HTTP-level. No page has been
  opened.

## Backend defect found

**`knowledge.version` never increments.** `PATCH /knowledge/:id` with
`expectedVersion: 1` succeeds, returns `version: 1`, and succeeds again with
the same value. The DTO accepts `expectedVersion` and the column exists, but
nothing bumps it, so optimistic concurrency cannot ever conflict and the
409-conflict UI is unreachable. The client keeps sending `expectedVersion` —
that is the correct behaviour once the server bumps the version — but the
protection is not currently real.

## Carried forward

The seven backend asks in §14 stand, and live data sharpened three of them:

- **Ask 1 (envelope spellings)** is now five shapes, not four, and every one
  is confirmed against a real response.
- **Ask 4 (`GET /notifications/:id`)** generalises: **twelve** endpoints have
  a list route and no item route. `noItemEndpoint` covers it client-side, but
  a record that cannot be re-read cannot be refreshed either — a seeded
  window shows the row as it was when the list last loaded.
- **New: `knowledge.version` never increments**, so `expectedVersion` can
  never conflict. See "Backend defect found" above.

Adding `GET /:id` to those twelve endpoints, and bumping `version` on
knowledge updates, would let the client delete `noItemEndpoint` and make the
conflict path real.
