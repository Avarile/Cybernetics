# Phase 5 — The Data window

**One window, every domain.** A `settings-dialog`-shaped shell whose sideNav routes
between the six data domains, whose pane header tabs between the schemas inside a
domain, and whose body is the generic `DataTable` from Phase 4.

Date: 2026-09-13. Written against the live backend at `api/src/features/*` and the
client as it stands at `7fe8944`.

---

## 1. Why this window exists

`WINDOW_COMPONENTS` already registers `contacts` and `files`. **Nothing opens
them.** The only `openWindow` call sites in the app are the auth gate, Terminal and
Voice (`shell-chrome.tsx:112,141`, `use-auth-gate.ts:38`). Phase 4 built a generic
table, two domain configs and three record windows, and then shipped without a
door.

This phase is that door — and the shape of the door determines whether adding the
seventh domain is a config object or another orphaned window kind. A per-domain
window kind does not scale: six domains with ~28 distinct resources between them
would mean 28 registry entries, 28 dock chips, and a user hunting for "where do I
open Budgets".

So: **one window kind, `data`.** Three levels of navigation inside it.

---

## 2. Anatomy

```
┌─ WindowFrame (existing chrome: title bar, drag, resize, minimise) ───────────┐
│ ┌──────────────┬────────────────────────────────────────────────────────────┐│
│ │ SIDENAV      │ Data › Finance › Invoices            [scope picker]        ││  ← header
│ │              ├────────────────────────────────────────────────────────────┤│
│ │ ▸ Contacts   │ [Transactions][Invoices][Budgets][Accounts][Recurring][⋯]  ││  ← section tabs
│ │ ▸ Finance ●  ├────────────────────────────────────────────────────────────┤│
│ │ ▸ Knowledge  │ [All][Draft][Sent][Overdue]  [search] [status ▾]   ⟳ ▣ +New││  ← DataTable toolbar
│ │ ▸ Notifics.  │ ┌────────────────────────────────────────────────────────┐ ││    (view tabs)
│ │ ▸ Projects   │ │ ☐ │ Number │ Bill to │ Due │ Total │ Paid │ Status │ ⋮ │ ││
│ │ ▸ Files      │ │ … rows …                                               │ ││
│ │ ▸ You        │ └────────────────────────────────────────────────────────┘ ││
│ │              │ 3 of 142 row(s) selected.   Rows per page 20   Page 1 of 8 ││
│ └──────────────┴────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────┘
```

Three levels, and they mean three different things. Conflating any two of them is
the main way this design goes wrong:

| Level | Control | Means | Changes |
|---|---|---|---|
| **Domain** | sideNav item | A bounded context | Everything |
| **Section** | tab in pane header | A *different schema / endpoint* | The table config |
| **View** | tab in DataTable toolbar | A *saved filter over one endpoint* | One query param |

`DomainTableConfig.tabs` already exists and already means **view**
(`contacts.config.tsx:57-61` — All / Active / Archived over `/contacts`). The new
thing is **section**, and it must not be built on the same field. Keeping them
spatially apart — sections above the table, views inside its toolbar — is what
makes two tab rows legible instead of confusing.

### 2.1 Reuse of `settings-dialog.tsx`, and what is dropped

`components/settings-dialog.tsx` is a vendored shadcn demo, exactly as
`components/data-table.tsx` is. Phase 4's rule applies again: **generalise it into
a new file; leave the vendored demo untouched as the reference.**

What is taken: `SidebarProvider className="items-start"` + `Sidebar
collapsible="none"` + `SidebarContent/Group/GroupContent/Menu/MenuItem/MenuButton`
for the nav, and `Breadcrumb*` in a `<header className="flex h-16 shrink-0 …">`
over a `<main className="flex flex-1 flex-col overflow-hidden">`.

What is dropped, and why:

- **The `Dialog` wrapper.** `WindowFrame` already renders `role="dialog"` with a
  title bar, close button and Escape handling (`window-frame.tsx:83,59-66`).
  Nesting a Radix `Dialog` inside it is a box in a box with two focus traps — the
  same reasoning `window-layer.tsx:50-53` gives for the auth gate's `chrome:
  "none"`.
- **The fixed `h-[480px]` / `md:max-h-[500px]` sizing.** The window is resizable;
  the shell must be `h-full min-h-0`.
- **`useState(true)` open state and the `DialogTrigger`.** Open/close is the
  workspace store's job.

The `SidebarProvider` is kept (the `Sidebar` primitives require its context) but
with `defaultOpen` irrelevant — `collapsible="none"` means the rail never
collapses. On narrow windows the sideNav becomes a `Select` in the header instead
(§10.2).

---

## 3. Files

### New

```
components/data-window/
  data-window.tsx        the shell: sidenav + header + section router
  domain-nav.tsx         sideNav list, + the narrow-window Select fallback
  section-tabs.tsx       tab row with overflow "⋯" menu for secondary sections
  scope-picker.tsx       required-parent selector for scoped sections
  section-host.tsx       renders a section: table | form | report | custom
  types.ts               DomainSpec, SectionSpec
  registry.ts            DOMAINS: DomainSpec[]  ← the one place a domain is added

components/domains/
  contacts.config.tsx    (exists — gains companies/types/categories configs)
  finance.config.tsx
  knowledge.config.tsx
  notifications.config.tsx
  projects.config.tsx
  profile.config.tsx
  files.config.tsx       (exists)
  cells.tsx              shared cell renderers: Money, DateCell, StatusBadge,
                         PriorityBadge, ProgressCell, Dash, RelativeTime
  panes/
    finance-reports.tsx  the one non-table section
    profile-form.tsx     /me/profile
    account-pane.tsx     principal card + password change

features/records/
  use-collection.ts      array endpoints → the DomainTable interface
  use-lookup.ts          id → label maps for reference columns and async filters
  use-singleton-record.ts  /me/profile: a resource of one
  use-row-action.ts      POST-verb row actions with invalidation
```

### Changed

| File | Change |
|---|---|
| `lib/windows/types.ts` | `WindowKind` gains `"data"`; retire `"contacts"`, `"files"` |
| `lib/windows/meta.ts` | `data` meta: `DatabaseIcon`, singleton, 1140×720, min 640×420 |
| `lib/windows/registry.tsx` | lazy `data` → `DataWindow`; drop `contacts`/`files` |
| `stores/workspace.store.ts` | new `patchWindowProps(id, patch)` action (§5.2) |
| `features/workspace/use-window-controls.ts` | expose `patchProps` |
| `components/shell/shell-chrome.tsx` | a "Data" button beside Terminal |
| `lib/api/types.ts` | `rowsOf()` gains the `rows` branch (§6.1) |
| `lib/swr/keys.ts` | `keys.collection`, `keys.lookup`, `keys.report`, `scopes.allCollections` |
| `lib/swr/fetcher.ts` | cases for the new key heads (the switch throws by design) |
| `components/data-table/types.ts` | `source`, `deleteKey`, row-level `canEdit`/`canDelete`, async filters (§4.2) |
| `components/data-table/data-table.tsx` | honour the above; nothing structural |
| `components/data-table/record-window.tsx` | split out `RecordForm` so `/me/profile` can reuse it |
| `components/data-table/record-forms.ts` | specs for every writable domain |

### Deleted

`components/domains/contacts-window.tsx`, `components/domains/files-window.tsx` —
their `openWindow` wiring moves into one shared place (§8.1). The **configs** stay;
they become sections.

Retiring the two kinds is safe: `isRestorable` filters any persisted window whose
kind is absent from `WINDOW_META` (`workspace.store.ts:114`), which is the
documented behaviour for "a deploy that retires a WindowKind". Nobody has one
persisted anyway — nothing could open them.

---

## 4. Type model

### 4.1 Domains and sections

```ts
// components/data-window/types.ts
import type { LucideIcon } from "lucide-react"
import type { UserRole } from "@/lib/api/types"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"

export type DomainKey =
  | "contacts" | "finance" | "knowledge"
  | "notifications" | "projects" | "files" | "profile"

/** A section that needs a parent id before it can load anything. */
export interface SectionScope {
  /** Path segment the parent fills: `/projects/{id}/milestones`. */
  param: "projectId"
  /** Collection the picker reads its options from. */
  from: string          // "/projects"
  labelKey: string      // "name"
  placeholder: string   // "Choose a project…"
}

export type SectionBody<T extends HasId = HasId> =
  | { kind: "table"; config: DomainTableConfig<T> }
  /** Scoped table: `config` is a factory, because the endpoint embeds the id. */
  | { kind: "scoped-table"; scope: SectionScope; config: (parentId: string) => DomainTableConfig<T> }
  | { kind: "form"; endpoint: string; spec: string }   // key into RECORD_FORMS
  | { kind: "custom"; render: () => React.ReactNode }  // reports, account card

export interface SectionSpec {
  key: string            // stable; persisted in window props
  label: string
  body: SectionBody
  /** Hidden entirely for principals outside this list. Omit ⇒ everyone. */
  roles?: UserRole[]
  /** Demoted into the tab row's "⋯" overflow. Reference/vocabulary data. */
  secondary?: boolean
  /** One line under the breadcrumb when the section needs explaining. */
  hint?: string
}

export interface DomainSpec {
  key: DomainKey
  label: string
  icon: LucideIcon
  sections: SectionSpec[]
  roles?: UserRole[]
}
```

`registry.ts` exports `DOMAINS: DomainSpec[]` and two resolvers
(`findDomain(key)`, `findSection(domain, key)`) that **fall back rather than
throw** — window props come out of `localStorage` and a retired section key must
degrade to "first visible section of the domain", not a blank pane.

### 4.2 Extensions to `DomainTableConfig`

Five additions. Each exists because a real endpoint in §7 cannot be expressed
without it.

```ts
export interface DomainTableConfig<T extends HasId> {
  // … existing fields unchanged …

  /**
   * "paged"      — `{ data|items|rows, total }`, server pages it.   (default)
   * "collection" — a bare JSON array; page/search/filter client-side.
   * Forced by the backend: /finance/accounts, /finance/recurring,
   * /me/preferences, /notifications/preferences, /projects/:id/members and
   * every vocabulary endpoint return arrays with no envelope. (§6.1)
   */
  source?: "paged" | "collection"

  /**
   * The path segment DELETE uses, when it is not the row id.
   * `DELETE /system/notifications/suppressions/:email`
   * `DELETE /projects/:id/members/:userId`
   * `DELETE /me/preferences/:key`
   */
  deleteKey?: (row: T) => string

  /** Per-row, not just per-domain: `PublicProject.access` says what this
   *  principal may do to THIS row, and a viewer must not see Edit. */
  canEdit?: boolean | ((row: T) => boolean)
  canDelete?: boolean | ((row: T) => boolean)

  /** Default sort, sent as `sort=&order=` on first load. */
  defaultSort?: { key: string; dir: "asc" | "desc" }
}

export interface FilterSpec {
  key: string
  label: string
  /** Static enum options … */
  options?: { value: string; label: string }[]
  /** … or options fetched from a collection endpoint. Exactly one of the two. */
  source?: { endpoint: string; valueKey?: string; labelKey: string }
  /** Above ~20 options a Select is unusable; switch to the Combobox. */
  searchable?: boolean
}

export interface ColumnSpec<T> {
  // … existing …
  /** Renders right-aligned + `tabular-nums`. Money and counts. */
  numeric?: boolean
}
```

Widening `canEdit`/`canDelete` is source-compatible — every existing config passes
a boolean. The toolbar's bulk-delete button gates on **every** selected row
passing `canDelete`, and shows a count of the eligible subset when they differ.

Deliberately **not** added: a `permissions` enforcement path. `permissions` is
declared on `DomainTableConfig` (`types.ts:66`) and read by nothing. See §9.

---

## 5. State management

Five layers, each owning exactly one kind of fact. The rule: **anything the server
knows lives in SWR; anything the workspace remembers lives in zustand; anything
only this table cares about lives in the table.**

| Fact | Owner | Persisted | Scope |
|---|---|---|---|
| Which windows are open, where, z-order | `workspace.store` | ✅ localStorage | app |
| Which domain + section the Data window shows | `workspace.store` → `props` | ✅ (same slice) | one window |
| Scope selection (which project) | `workspace.store` → `props` | ✅ | one window |
| Rows, totals, records, lookups | SWR cache | ❌ | app (shared by key) |
| Page / limit / search / filters / view tab | `useDomainTable` local state | ❌ | one table mount |
| Row selection, hidden columns | `DataTable` local state | ❌ | one table mount |
| Tokens | `session.store` | refresh only | app |

### 5.1 Why navigation goes in window props, not a new store

A new `domains.store` would have to key everything by window id and clean up on
close — a second lifecycle shadowing one that already exists and is already
tested. Window `props` is a `JsonObject` that the persist slice already carries
(`serialiseForPersist`), so putting `{ domain, section, scope }` there means
reopening the app lands you back on Finance › Invoices for free, and
`openWindow({ kind: "data", props: { domain: "finance", section: "invoices" } })`
is a deep link with no extra machinery.

The gap: `openWindow` writes props once and nothing can change them.

### 5.2 `patchWindowProps`

```ts
// stores/workspace.store.ts
patchWindowProps: (id: string, patch: JsonObject) =>
  set((state) => {
    const win = state.windows.find((w) => w.id === id)
    if (!win) return
    // `__key` is the de-duplication identity (keyOf) and must survive a patch —
    // clobbering it would orphan the window from its own singleton slot.
    win.props = { ...win.props, ...patch, __key: win.props?.__key }
  }),
```

Two things this must not break:

- **`isRestorable` does not validate props** (`workspace.store.ts:101-116`), by
  design — props are an untyped bag. So `DataWindow` treats
  `props.domain`/`props.section` as *hints*: unknown values fall back to the first
  visible domain/section rather than rendering nothing. A hand-edited
  `localStorage` must not produce a blank window.
- **Patching props must not bump z-order.** It is not a focus event; a section
  switch raising the window over a modal would be a bug.

`useWindowControls(id)` gains `patchProps: (patch) => patchWindowProps(id, patch)`.

### 5.3 Mount keying — what resets and what does not

`section-host.tsx` renders **only the active section**, keyed:

```tsx
<SectionHost key={`${domain.key}:${section.key}:${scopeId ?? ""}`} … />
```

Consequences, all intended:

- Switching section **unmounts** the previous table → its page, search, filters,
  view tab, selection and hidden columns reset. A section is a different resource;
  carrying page 7 of Transactions into Invoices is meaningless.
- Switching **back** also resets. Accepted for v1. The escape hatch, if it ever
  proves annoying: hoist `TableQuery` into `props` under
  `queries[`${domain}:${section}`]`. Not now — it triples the persisted payload
  to solve a problem nobody has reported.
- Only one section fetches at a time. Rendering all sections and hiding the
  inactive ones would fire ~28 requests to open one window.
- Changing the scope (project) remounts too — a scoped table's endpoint changes,
  so its cache key changes anyway.

Switching sections does **not** evict the SWR cache. Coming back inside
`dedupingInterval` (2s) paints from cache instantly; beyond it, SWR revalidates
while showing the cached page. That is the right behaviour and comes for free.

### 5.4 Cross-window coherence

Unchanged from Phase 4 and worth restating, because the Data window makes it
visible for the first time: mutations invalidate **by key prefix**
(`scopes.allLists(endpoint)`), so two Data windows on the same domain, or a Data
window and a `record-edit` window, converge without either knowing about the
other (`use-record-mutations.ts:14-22`). New in this phase:

```ts
scopes.allCollections = (endpoint: string) => ["collection", endpoint] as const
```

and every write helper invalidates lists **and** collections for its endpoint,
because a new account must appear both in `/finance/accounts` (the table) and in
the Account filter's option list on the Transactions section.

---

## 6. Data access

### 6.1 The envelope problem

Phase 4 found `/files` returns `items` where everything else returns `data`, and
`rowsOf()` was widened to read either. Auditing the six domains turns up a **third**
shape and a large fourth class:

| Shape | Endpoints |
|---|---|
| `{ data, total, page, limit }` | `/contacts`, `/companies`, `/knowledge`, `/projects`, `/tasks`, `/tasks/time`, `/notifications`, `/invoices`, `/finance/transactions`, `/users`, `/tags` |
| `{ items, total, page, limit }` | `/files` |
| **`{ rows, total }`** — no page/limit | **`/finance/budgets`** (`finance.repository.ts:182-202`, returned straight through `budget.service.ts:26`) |
| **bare `T[]`** | `/finance/accounts`, `/finance/categories`, `/finance/currencies`, `/finance/fx-rates`, `/finance/recurring`, `/notifications/preferences`, `/system/notifications/templates`, `/system/notifications/event-types`, `/me/preferences`, `/projects/:id/members`, `/projects/:id/milestones`, `/projects/:id/goals`, `/contact-vocabulary/*`, `/knowledge-vocabulary/*` |
| **bare `T[]`, server-sliced, no total** ⚠ | **`/system/notifications/suppressions`** — accepts `page`/`limit`, applies `.limit().offset()`, and returns the naked array (`notification.repository.ts:471-482`). The client cannot know whether there is a page 2. |

That last row is the nastiest of the five, because it looks like a collection and
behaves like a truncation. Handled in §7.4; logged in §14.

**Budgets is a one-line fix.** `useDomainTable` reads only `rowsOf(data)` and
`data.total`; it never reads `page`/`limit` back from the response
(`use-domain-table.ts:51,76`). So adding a `rows` branch to `rowsOf()` makes
Budgets work completely:

```ts
export interface Paginated<T> { data?: T[]; items?: T[]; rows?: T[]; total: number; page?: number; limit?: number }
export function rowsOf<T>(p?: Paginated<T> | null): T[] { return p?.data ?? p?.items ?? p?.rows ?? [] }
```

with regression tests for all four cases, as `items` got.

**This papers over a backend inconsistency, again.** Three spellings of "the rows"
across one API is a defect; the real fix is hoisting one shared `Paginated<T>` and
normalising `file.service.list` and `finance.repository.listBudgets` onto `data`.
That is a backend change nobody has approved. Logged in §14.

### 6.2 `useCollection` — array endpoints

Bare arrays need paging, search and filtering *somewhere*. Doing it client-side is
correct here and only here: these are bounded sets — accounts, categories,
milestones, preference rows — tens of items, not the 282 contacts that forced
server paging in the first place.

```ts
// features/records/use-collection.ts
export function useCollection<T extends HasId>(config: DomainTableConfig<T>): DomainTable<T>
```

It returns **the same `DomainTable<T>` interface** as `useDomainTable`, so
`DataTable` never learns which kind of endpoint it is rendering. Internally: one
`useSWR(keys.collection(endpoint))`, then `useMemo` over the array applying tab
query params → filters → search (substring over the columns' string cells) →
sort → slice.

`useDomainTable` becomes the dispatcher. Hooks cannot be called conditionally, so
both run and one is keyed `null`:

```ts
export function useDomainTable<T extends HasId>(config: DomainTableConfig<T>): DomainTable<T> {
  const paged = usePagedTable(config, config.source !== "collection")
  const collection = useCollection(config, config.source === "collection")
  return config.source === "collection" ? collection : paged
}
```

Every existing call site keeps working — `source` defaults to `"paged"`.

### 6.3 `useLookup` — ids to labels

Half the columns in Finance and Projects hold foreign keys the API does not
expand: `transactions.accountId`, `transactions.categoryId`, `tasks.projectId`,
`invoices.contactId`, `budgets.projectId`. Rendering a raw UUID in a table cell is
rendering nothing.

```ts
// features/records/use-lookup.ts
export function useLookup(endpoint: string, labelKey = "name"): {
  label: (id: string | null) => string      // falls back to "—", then to a short id
  options: { value: string; label: string }[]
  isLoading: boolean
}
```

One SWR key per endpoint (`keys.lookup(endpoint)`), shared by every consumer — the
Account column, the Account filter and the Account field in the transaction form
all read the same cache entry, one request. Backed by `/finance/accounts`,
`/finance/categories`, `/projects`, `/contacts`, `/users`.

While loading, cells render a `Skeleton` sized to the column, not a flash of raw
UUID.

For endpoints that are paged rather than arrays (`/projects`, `/contacts`,
`/users`) the lookup requests `?limit=100` and, if `total > 100`, falls back to
rendering the id short-form with a tooltip. Honest degradation beats a silently
wrong label. (A backend `?ids=` batch endpoint would fix it properly — §14.)

### 6.4 Writes

- **Standard CRUD** — `useRecordMutations(endpoint)`, unchanged.
- **Singleton resources** — `useSingletonRecord("/me/profile")`: `GET` + `PATCH`
  with no id segment. `useRecordMutations.update` builds `${endpoint}/${id}`,
  which is wrong for a resource of one.
- **Verb endpoints** — `useRowAction()`. Finance and Knowledge expose state
  changes as POSTs, not as fields:

  ```
  POST /finance/transactions/:id/status/:status     draft→pending→cleared→reconciled→void
  POST /finance/transactions/:id/reverse
  POST /invoices/:id/issue | /void | /payments | /lines | /bill-time
  POST /knowledge/:id/status                        { status, note }
  POST /finance/recurring/materialize
  ```

  Each is a row action that POSTs, invalidates `allLists` + `allRecords` +
  `allCollections`, and reports failure inline. Never an editable form field —
  `knowledge.service.ts` enforces a transition table (`TRANSITIONS`, lines
  59-66) and `ledger.service` guards status moves with `FOR UPDATE`; a form that
  PATCHes `status` would be lying about what the server accepts.

- **Interactive cells** — `useCellMutation(endpoint, method)`. Notification
  preferences and user preferences are edited in place (a `Switch`, a `Select`)
  rather than through a form window. Optimistic via SWR `mutate(key, updater,
  { revalidate: false })`, rolled back and toasted on failure. `sonner` is
  already a dependency and `components/ui/sonner.tsx` exists.

---

## 7. The domains

Column lists below are the **default visible** set; everything except the first
column is hideable through the existing Columns menu.

### 7.1 Contacts — `UsersIcon`

| Section | Endpoint | Source | Writes |
|---|---|---|---|
| People | `/contacts` | paged | C·U·D |
| Companies | `/companies` | paged | C·U·D |
| Types ˢ | `/contact-vocabulary/types` | collection | C·U·D (admin) |
| Categories ˢ | `/contact-vocabulary/categories` | collection | C·U·D (admin) |

ˢ = secondary (overflow menu)

**People** — `contactsConfig` as it stands, extended.
Columns: Name · Email · Title · Phone · Company · Status · Visibility · Last contacted.
Views: All / Active / Archived. Filters: `status` (enum) + **new**: `companyId`
(source `/companies`, searchable), `typeId`, `categoryId`, `tagId` (source
`/tags`) — all four are accepted by `listContactsSchema` (`contact.dto.ts:105-114`)
and none were reachable.
Form (`RECORD_FORMS.contacts`) exists and already mirrors the DTO's
`.refine()` ("Provide a name or an email address").

**Companies** — `listCompaniesSchema`: search + status + page/limit.
Columns: Name · Domain · Industry · Size · Country · Status.
Views: All / Active / Archived. Form from `createCompanySchema`: name*, legalName,
domain, industry, size (enum), website, phone, country (2 chars), status,
taxNumber, description.

**Types / Categories** — vocabulary. Columns Name · Key · Sort order (+ Colour swatch
for types; Parent for categories). Categories are a materialised-path tree
(`path`/`depth`): the Name cell indents by `depth` and the default sort is `path`,
so the tree reads as a tree inside a flat table. `key` is **createOnly** — the DTO
omits it from the update schema because it is immutable once set.

**Contact detail** — v1 ships flat (`record-detail`). The three per-record
collections (`/contacts/:id/channels`, `/relationships`, `/interactions`) land in
increment 5c as record-window tabs (§8.5).

### 7.2 Finance — `WalletIcon`

Eight resources. Six primary, two secondary.

| Section | Endpoint | Source | Writes |
|---|---|---|---|
| Transactions | `/finance/transactions` | paged | C only + verbs |
| Invoices | `/invoices` | paged | C only + verbs |
| Budgets | `/finance/budgets` | paged (`rows`!) | C only |
| Accounts | `/finance/accounts` | collection | C only |
| Recurring | `/finance/recurring` | collection | C·D + verb |
| Reports | — | custom | read |
| Categories ˢ | `/finance/categories` | collection | read |
| FX rates ˢ | `/finance/fx-rates` | collection | C (upsert) |

**Transactions.** Columns: Date (`occurredOn`) · Description · Kind (badge) ·
Amount (numeric, `currency` + sign derived from `kind`) · Account (lookup) ·
Category (lookup) · Status (badge) · Reference.
Views: All / Income / Expense / Transfers (`kind=`). Filters: `status`,
`accountId`ᴸ, `categoryId`ᴸ, `projectId`ᴸ, `contactId`ᴸ, and a `from`/`to` date
range (both are `isoDate` in `listTransactionsSchema:110-111`).
**`canEdit: false`, `canDelete: false`** — the API exposes neither PATCH nor
DELETE on a transaction. Corrections are reversing entries, by design
(`finance.schema.ts`: *"A correction is a reversing entry, never an edit of a
settled row"*). Offering Edit would 404 and teach the user the wrong model.
Row actions instead: **Mark pending / cleared / reconciled / void** (`POST
…/status/:status`, each hidden when the transition is not legal from the row's
current status) and **Reverse…** (destructive-styled confirm → `POST …/reverse`).

The amount cell is the one place a rendering mistake is expensive: amounts are
**decimal strings** (`numeric(20,4)`, never floats — `money.util.ts`). The `Money`
cell in `cells.tsx` formats via `Intl.NumberFormat` from the string **without ever
parsing to `Number`** for display, and colours by `kind` (income positive,
expense negative, transfer neutral) rather than by a sign the column does not
carry.

**Invoices.** Columns: Number · Bill to (contact or company, lookup) · Issued ·
Due · Total · Paid · Balance (derived: `total − amountPaid`) · Status (badge).
Views: All / Draft / Sent / Partially paid / Overdue / Paid / Void — all six are
values of `listInvoicesSchema.status`, so every view is one query param. (There is
also a dedicated `GET /invoices/overdue`; the filter covers it and the extra
endpoint stays unused.) Filters: `status`, `contactId`ᴸ, `companyId`ᴸ, `projectId`ᴸ.
Create only. Row actions: **Add line…**, **Bill time…**, **Issue**, **Record
payment…**, **Void** — each visible only where the status allows it (`Issue` on
draft; `Record payment` on sent/partially_paid; `Void` on anything not already
void or paid).
Detail: `GET /invoices/:id` returns `{ …invoice, lineItems, payments }`
(`invoice.service.ts:65`), so the detail window shows the header fields plus two
small read-only tables. This is the first record window with a non-flat body and
the pilot for §8.5.

**Budgets.** Columns: Name · Period (`periodStart – periodEnd`) · Amount · Spent ·
**Used** (a `Progress` bar + `%`, computed from `spentAmount/amount`, tinted amber
at `alertThresholdPct` and red past 100) · Status · Project (lookup).
Filter: `projectId`. Create only. A toolbar toggle **"At risk only"** swaps the
endpoint to `/finance/budgets/at-risk` — implemented as a view tab whose
`query` is empty but whose section swaps config, or more simply as a second
(secondary) section. **Decision: a view tab is wrong here** (it changes the path,
not a param); ship it as a toolbar `Button` that patches the section's endpoint —
i.e. two configs, one toggle.

**Accounts.** Columns: Name · Kind (badge) · Institution · Currency · Current
balance (numeric) · Active. Create only; no PATCH/DELETE exist. Row action
**Reconcile** → `GET /finance/accounts/:id/reconcile`, shown in a small
`record-detail`-style window comparing stored vs. computed balance.

**Recurring.** Columns: Name · Kind · Amount · Frequency · Next due · Auto-post
(badge — `false` means *forecast only, nothing posts*) · Active.
Create + Delete (`DELETE /finance/recurring/:id`, 204). Toolbar action
**Materialize due** → `POST /finance/recurring/materialize`, with a confirm,
because it writes ledger rows.
Note `list(activeOnly = true)` — the endpoint takes no parameter, so **inactive
schedules are invisible**. The empty state and the Active column both say so
rather than implying the list is complete.

**Reports** — the one section that is not a table, and the reason `SectionBody`
has a `custom` variant. A report is an aggregate, not a row set; forcing it into
`DataTable` would mean a table with no id column, no selection and no pagination.
Layout: a date-range control (`from`/`to`, defaulting to the current quarter) +
`projectId`ᴸ, over
- `GET /finance/reports/summary` → four `SectionCards`-style figures,
- `GET /finance/reports/income-by-category` and `…/spend-by-category` → two
  breakdown tables with inline bars,
- `GET /finance/reports/forecast` → an area chart (`components/ui/chart.tsx`,
  recharts, already vendored as `chart-area-interactive.tsx`).

**Categories** — read-only (a `createCategory` exists in the repository but no
controller route reaches it). Tree-indented by `path`/`depth`, `kind` badge.
**FX rates** — Pair (`BASE/QUOTE`) · Rate · As of · Source. Create is an **upsert**
on `(base, quote, asOf)`; the form says so ("Re-recording a pair on the same date
corrects that day's observation").

ᴸ = filter options from `useLookup`

### 7.3 Knowledge — `BookOpenIcon`

| Section | Endpoint | Source | Writes |
|---|---|---|---|
| Articles | `/knowledge` | paged | C·U·D + verb |
| Types ˢ | `/knowledge-vocabulary/types` | collection | C·U·D (admin) |
| Categories ˢ | `/knowledge-vocabulary/categories` | collection | C·U·D (admin) |

**Articles.** Columns: Title · Status (badge) · Type (lookup) · Visibility ·
Version · Language · Review due · Updated.
Views: All / Draft / In review / Published / Archived.
Filters: `status`, `typeId`ᴸ, `categoryId`ᴸ, `tagId`ᴸ. Search.

Three things make this domain different:

1. **Status is not an editable field.** `POST /knowledge/:id/status` enforces a
   transition table (`draft ← in_review|archived`, `published ← draft|in_review|
   archived` needing `manage`, …). The form shows status **read-only**; the row
   menu offers only the transitions legal from the row's current status, each
   prompting for the optional `note`.
2. **Optimistic concurrency.** `updateKnowledgeSchema.expectedVersion`. The edit
   form captures `version` at load and sends it; a 409 renders *"This was changed
   by someone else — reload to see the current version"* with a Reload button that
   invalidates `allRecords` rather than silently overwriting. This is the only
   domain with it, and dropping it would make concurrent edits lose data silently.
3. **`total` is post-ACL.** `knowledge.service.ts:185-190` pages in SQL, then
   filters by resolved access, then returns `total: visible.length` alongside
   `totalBeforeAccess: total`. So a page can be short and the pager's page count
   is computed from a filtered count. The table shows `total` and, when
   `totalBeforeAccess > total`, a muted footnote: *"N records on this page are not
   visible to you."* Pretending the numbers agree is how a user concludes the
   search is broken.

`access` (`'none'|'read'|'comment'|'write'|'manage'`) is returned per row and
drives `canEdit: (r) => r.access === "write" || r.access === "manage"`,
`canDelete: (r) => r.access === "manage"`.

Grants (`/knowledge/:id/grants`) and linked contacts (`/knowledge/:id/contacts`)
are record-level; increment 5c.

### 7.4 Notifications — `BellIcon`

| Section | Endpoint | Source | Writes | Roles |
|---|---|---|---|---|
| Inbox | `/notifications` | paged | none | user, admin |
| Preferences | `/notifications/preferences` | collection | PUT | user, admin |
| Templates ˢ | `/system/notifications/templates` | collection | PUT | **admin** |
| Suppressions ˢ | `/system/notifications/suppressions` | collection ⚠ | C·D | **admin** |
| Event types ˢ | `/system/notifications/event-types` | collection | none | **admin** |

**Inbox.** Columns: Subject · Preview · Status (badge: pending/queued/sent/failed)
· Entity (`entityType` + link affordance) · Sent · Created.
**No search box, no filters, no view tabs** — `listNotificationsSchema` accepts
`page` and `limit` and nothing else (`notification.dto.ts:4-7`). Offering controls
the API silently ignores is worse than not having them; this is the same call
`filesConfig` made about its missing `search` (`files.config.tsx:46-48`).
`canCreate/canEdit/canDelete: false`.
**There is no `GET /notifications/:id`.** Row click therefore opens a detail
window rendered **from the row already in hand**, passed through props — not
fetched. `RecordWindow` currently always calls `useRecord`; it gains an optional
`seed?: JsonObject` prop that short-circuits the fetch when the domain has no item
endpoint. Without this, clicking a row 404s.

There is also **no read/unread** concept in the schema — `status` is a *delivery*
state (`notification.schema.ts`), not a read receipt. The UI must not draw an
unread badge it cannot compute. (§14.)

**Preferences** — the clearest case of "a different domain needs a different
table". Rows are events, not records; there is no create, no delete, and the two
editable fields are edited **in the cell**:

Columns: Event (`name`, with `eventKey` muted beneath) · Category ·
**Enabled** (`Switch`) · **Frequency** (`Select`: immediate/hourly/daily/weekly/off)
· **Quiet hours** (two hour `Select`s, 0–23, nullable).
Every change PUTs the whole `{ eventKey, enabled, frequency, quietHoursStart,
quietHoursEnd }` — the endpoint is an upsert keyed on `eventKey`, not a PATCH.
`isMandatory` rows render the switch **checked and disabled** with a tooltip
*"Required — security and transactional mail cannot be turned off"*, mirroring the
403 the server would return (`notification-admin.service.ts:99-104`). Showing an
enabled control that always fails is the thing `RowMenu` already refuses to do
("a control that can never be enabled is noise").
No selection checkboxes on this table — nothing bulk-acts on a preference. That
needs one more config flag: `selectable?: boolean` (default true).

**Suppressions** — Email · Reason (badge) · Event · Expires · Note · Created.
Two traps, both in one small endpoint:

- `DELETE /system/notifications/suppressions/:email`. The row's `id` is a UUID;
  the path wants the email. This is exactly what `deleteKey` is for:
  `deleteKey: (r) => r.email`, threaded through `ConfirmWindow`'s `ids` prop
  (renamed in spirit to "path keys", not in name, to avoid churn).
- The list **slices server-side and returns no total** (§6.1). Treated as a
  `collection`, requesting `?limit=100` (the DTO's max) and paginating those
  client-side. When exactly 100 rows come back, the footer reads *"Showing the
  first 100 — there may be more"* instead of "100 rows". Reporting a total the
  response does not contain is how Phase 4's `/files` bug looked from the
  outside: a confident, wrong number.

`POST /system/notifications/suppressions` returns 204 with no body, so the create
form closes on success and relies on invalidation rather than an echoed row.

### 7.5 Projects — `FolderKanbanIcon`

| Section | Endpoint | Source | Writes |
|---|---|---|---|
| Projects | `/projects` | paged | C·U·D |
| Tasks | `/tasks` | paged | C·U·D + verbs |
| Time | `/tasks/time` | paged | U·D |
| Milestones | `/projects/:id/milestones` | **scoped** collection | C·U·D |
| Goals | `/projects/:id/goals` | **scoped** collection | C·U·D |
| Members ˢ | `/projects/:id/members` | **scoped** collection | C·D |

**Projects.** Columns: Key · Name · Status (badge) · Priority (badge) · Lead
(lookup `/users`) · **Progress** (`Progress` + `progressPct`) · Due · Access.
Views: All / Active / On hold / Completed / Archived. Filters: `status`,
`ownerUserId`ᴸ. Search.
`access` is `'none'|'viewer'|'contributor'|'manager'|'owner'` and gates per row:
`canEdit: (r) => r.access === "manager" || r.access === "owner"`,
`canDelete: (r) => r.access === "owner"`.
Form: `key` is **createOnly** and validated `^[A-Z][A-Z0-9_]*$` client-side
(`createProjectSchema` omits it from update). `ownerUserId` appears only on the
update form — ownership moves through `PATCH /projects/:id` alone, deliberately
(`project.dto.ts:22-31`), and must not be offered in the members UI.

**Tasks.** Columns: Ref (`{projectKey}-{number}`, composed from the `/projects`
lookup — the row carries only `projectId` and `number`) · Title · Status (badge) ·
Priority · Assignee (lookup `/users`) · Due · Estimate/Spent (`estimateMinutes`
vs `spentMinutes`, rendered `2h 30m`).
Views: All / Todo / In progress / Blocked / In review / Done.
Filters: `projectId`ᴸ, `status`, `assigneeUserId`ᴸ, `milestoneId`. Search.
Row actions: **Move…** (`POST /tasks/:id/move` — status and/or `afterTaskId`),
**Log time…** (`POST /tasks/:id/time`), **Watch / Unwatch**
(`POST|DELETE /tasks/:id/watch`).
`blockedReason` is required by the service when moving to `blocked`, so the Move
dialog asks for it conditionally — the DTO alone does not say this
(`task.dto.ts:57`), the service does.

**Time.** Columns: Date (`workDate`) · Project (lookup) · Task (lookup) · Who
(lookup) · Duration (`minutes` → `h:mm`) · Billable · Rate · **Invoiced** (a lock
icon when `invoiceLineItemId` is set).
Filters: `projectId`ᴸ, `taskId`, `userId`ᴸ, `from`/`to`.
Edit via `PATCH /tasks/time/:entryId`, delete via `DELETE /tasks/time/:entryId` —
note the endpoint for the item is **`/tasks/time`**, not `/tasks`, so this section
sets `endpoint: "/tasks/time"` and the generic `${endpoint}/${id}` composition is
correct. Rows with `invoiceLineItemId` set are not editable
(`canEdit: (r) => !r.invoiceLineItemId`) — the FK is the "already billed" lock.
`updateTimeSchema` deliberately excludes `taskId`/`projectId`; the form must not
offer them.

**Milestones / Goals / Members** — the scoped sections, and the reason
`SectionScope` exists. `GET /projects/:id/milestones` has no unscoped form: without
a project there is nothing to request. The section header renders a **project
Combobox** (options from the `/projects` lookup); with nothing chosen the pane
shows an `Empty` state — *"Choose a project to see its milestones"* — and **no
table and no request**. An error would be wrong; a blank table would be a lie.
The chosen project is stored in window props (`scope.projectId`) so it survives
section switches and reloads, and is shown in the breadcrumb:
`Data › Projects › Milestones › ACME`.

- Milestones: Name · Status (badge) · Due · Owner (lookup) · Sort.
  Note the write paths are **unscoped**: `PATCH|DELETE /projects/milestones/:id`.
- Goals: Title (key results indented under their objective via `parentGoalId`) ·
  Kind · Status · Metric · Current/Target + `direction` arrow · Due.
  The create form enforces the DTO's `superRefine` client-side: a key result must
  have a parent, an objective must not.
- Members: User (lookup) · Role in project · Added.
  `DELETE /projects/:id/members/:userId` → `deleteKey: (r) => r.userId`. The role
  select offers `manager|contributor|viewer` only — `owner` is deliberately absent
  from `ASSIGNABLE_MEMBER_ROLES`, and offering it would reproduce the privilege
  escalation that comment documents.

### 7.6 Files — `FileIcon`

One section, unchanged from Phase 4: `filesConfig` + `<FileDropzone />` as
`toolbarExtra` + the Download row action. It moves into this window and stops
being unreachable.

### 7.7 You — `UserIcon`

Not a row set. Four sections, three of which are not tables.

| Section | Endpoint | Body |
|---|---|---|
| Profile | `/me/profile` | **form** |
| Preferences | `/me/preferences` | collection table, interactive cells |
| Account | — | **custom** |
| Users ˢ | `/users` | paged table, **admin** |

**Profile** — `GET /me/profile` (always returns a shape, even when never written:
`EMPTY_PROFILE`), `PATCH /me/profile`. Fields: first name, last name, job title,
department, phone, timezone, locale, dateFormat, timeFormat, bio (textarea),
avatarFileId. Rendered by `RecordForm` — extracted from `RecordWindow` so the same
field specs, validation and save affordances serve both a window and a pane. There
is no id in the path, hence `useSingletonRecord`.
`timezone` is an IANA zone read by the notification scheduler for quiet hours, so
it is a `Select` over `Intl.supportedValuesOf("timeZone")`, not a free-text field
that can be typo'd into breaking delivery.

**Preferences** — key/value with a declared type
(`string|number|boolean|json`). Columns: Key · Type · **Value** (an input whose
control follows `type`: `Input`, `Input type=number`, `Switch`, `Textarea` with
JSON validation) · Clear. `PUT /me/preferences/:key`, `DELETE /me/preferences/:key`
→ `deleteKey: (r) => r.key`. The `superRefine` on `setPreferenceSchema` (value must
match declared type) is mirrored client-side so a mistyped JSON blob fails before
the request.

**Account** — a read-only card from `useSession().principal`: email, role, id,
principal kind. Plus **Change password** (`PATCH /auth/password`, the
`change-password.dto` rules already mirrored in `lib/api/types.ts`:
`PASSWORD_MIN_LENGTH` 12 / max 200) and **Sign out** (`useSignOut`, already built).

**Users** (admin) — `GET /users`. Columns: Email · Role · Display name · Created ·
Last login. C·U·D. `updateUserSchema` allows `role`, `password`, `displayName`;
the form warns that changing a role revokes that user's cached permissions and
sessions (`users.service` calls `SessionRevocationService`).

---

## 8. Interaction

### 8.1 One place that opens record windows

`contacts-window.tsx` hand-wrote four `openWindow` calls. Multiplying that by ~28
sections is the failure mode this phase exists to avoid. Instead, `section-host.tsx`
derives all four handlers from the section spec:

```tsx
const nav = useRecordWindows(section)   // features/records/use-record-windows.ts
<DataTable config={config} {...nav} />
```

with `singletonKey` composed as `` `${config.key}:${mode}:${row.id}` `` — the same
convention Phase 4 used, now generated rather than typed. One window per record
per mode; a second click focuses rather than duplicates.

Record windows stay **separate top-level windows**, not panes inside the Data
window. Reasons: `record-*` kinds are already registered, already excluded from
persistence (`NEVER_PERSIST`), and already self-close via `__windowId`; and
comparing two records side by side is a thing people do and a pane cannot.

### 8.2 Row click

`onOpen` → `record-detail`. Selection checkboxes and the row menu stop propagation
(already handled, `data-table.tsx:264,277`).

### 8.3 Destructive actions

Unchanged: `ConfirmWindow`, modal, one dialog per selection (`singletonKey`
embeds the ids), partial failure reported honestly ("3 of 5 deleted"). Extended
only by `deleteKey` for the three delete-by-non-id endpoints.

### 8.4 Verb actions

A row action that POSTs shows its result inline: a spinner on the menu item while
in flight, a `sonner` toast on success naming what changed, and an inline error
row on failure. Destructive verbs (Void, Reverse, Materialize) route through
`ConfirmWindow` with `destructive: true`.

### 8.5 Record windows with relations — increment 5c

Deferred, with the seam defined now so nothing has to be rewritten:
`RecordFormSpec` gains `relations?: { key, label, endpoint: (id) => string,
config: DomainTableConfig }[]`. When present, `RecordWindow` renders
`Tabs`: *Details* + one tab per relation, each a small `DataTable`. This is the
"multiple schemas → tabs" rule applied one level down, and it covers contact
channels/relationships/interactions, knowledge grants/contacts, invoice
lines/payments, task dependencies/watchers, project knowledge/contact links.

---

## 9. Access control

There is **no endpoint that tells a client its own permissions.**
`GET /authorization/users/:userId/effective` is itself `@RequirePermission
('rbac.manage')` and `@Roles('admin')` — a normal user cannot read their own
effective permissions. So client-side gating has exactly two honest inputs:

1. **`principal.role`** (`user | admin | agent`) from `/auth/me` — used for
   `SectionSpec.roles`, which hides the five admin-only sections. A hidden section
   is not a security control; the server still enforces. It is there so a normal
   user is not shown five tabs that all render 403.
2. **Per-row `access`** on `PublicProject` and `PublicKnowledge` — the server
   telling the client what this principal may do to this row, explicitly *"so a
   client need not guess"*. This is the one trustworthy signal and it drives
   `canEdit`/`canDelete` as functions.

`DomainTableConfig.permissions` stays declared and unenforced. It documents the
backend key each action needs and is the hook for a future
`GET /me/permissions`. Wiring it to `role` would be wrong — permissions are
grantable independently of role.

**Everything else is optimistic**: the action is offered, and a 403 renders the
server's message. That is honest. Guessing a permission set client-side and
hiding a button the user actually has is worse than a clear refusal.

---

## 10. States, responsiveness, accessibility

### 10.1 The four states, per section

`TableState` already distinguishes loading / empty / error, because *"'no rows' and
'the request failed' look identical if both render as an empty table, and that is
how a broken filter gets mistaken for an empty domain."* Sections add a fourth:

- **Unscoped** — a scoped section with no parent chosen. `Empty` component with
  the picker repeated in the body. No request is made.
- **Forbidden** — a 403 from a section the role check let through (a permission,
  not a role, was missing). Renders the server's message and a "Back to {first
  section}" link, not a retry loop.

The window itself has no loading state: the shell renders immediately, the section
lazily. `WindowLayer` already wraps bodies in `Suspense` with a `Spinner`.

### 10.2 Responsive

`WindowFrame` already swaps to a full-height `Sheet` below `md`
(`window-frame.tsx:68-79`), so the Data window inherits mobile behaviour. Inside:

- **< `md`**: the sideNav is replaced by a `Select` in the header (`Domain ▾`);
  section tabs become a second `Select` when more than three are visible.
  Same state, different control — the `settings-dialog` demo already hides its
  sidebar at this breakpoint (`hidden md:flex`).
- **Narrow but ≥ `md`** (a 640px-wide floating window): sideNav collapses to icons
  with tooltips; section tabs overflow into the "⋯" menu earlier.
- The table scrolls in its own `overflow-auto` container with a sticky header
  (already the case, `data-table.tsx:225-227`); the window never scrolls as a whole.

### 10.3 Keyboard and ARIA

- sideNav is a `SidebarMenu` (`ul`/`li`/`button`) with `isActive` on the current
  domain → `aria-current="page"`. Arrow keys move between items.
- Section tabs are Radix `Tabs`, so roving tabindex and `aria-selected` come free.
  The overflow menu is a `DropdownMenu`, reachable in the same tab stop.
- Breadcrumb mirrors the state for screen readers: `Data › Finance › Invoices`,
  last crumb `BreadcrumbPage`.
- `Escape` closes the window (`window-frame.tsx:59-66`) — **not** the section.
  Section navigation has no dismiss gesture, which is correct; it is navigation,
  not a dialog.
- Every icon-only control already carries `aria-label` (Refresh, Row actions,
  window controls). New ones follow.
- Focus on section change moves to the pane's `<main>` (`tabIndex={-1}`), so a
  screen-reader user is not left in the tab row while the content changes.

---

## 11. Wiring

```ts
// lib/windows/types.ts
export type WindowKind =
  | "auth" | "terminal" | "voice" | "data"
  | "record-create" | "record-edit" | "record-detail" | "confirm"
  // retired: "contacts", "files"  (folded into "data")
  // still declared, still unimplemented: "settings", "search", …

// lib/windows/meta.ts
data: {
  kind: "data", title: "Data", icon: DatabaseIcon,
  singleton: true, modal: false,
  defaultRect: { w: 1140, h: 720 }, minSize: { w: 640, h: 420 },
},

// lib/windows/registry.tsx
data: lazy(() => import("@/components/data-window/data-window")
  .then((m) => ({ default: m.DataWindow }))),
```

`shell-chrome.tsx` gains one button beside Terminal:

```tsx
<Button … onClick={() => openWindow({ kind: "data" })}>
  <DatabaseIcon className="size-3.5" /> Data
</Button>
```

Deep links are `openWindow({ kind: "data", props: { domain, section } })`. Because
`data` is a singleton, a second call focuses the existing window — and should also
**patch it to the requested domain/section**. `openWindow`'s existing behaviour is
focus-and-return; `useOpenData(domain, section)` wraps it to `openWindow` then
`patchWindowProps` on the returned id. That is how the agent, a notification, or a
future search result navigates someone to a record's domain.

---

## 12. Testing

Following Phase 4's split: pure logic gets unit tests, components get behaviour
tests, and the bugs that only live data surfaces get named as such.

**Pure**
- `registry` resolvers: unknown domain → first domain; unknown section → first
  *visible* section; a section whose `roles` exclude the principal is skipped.
- `rowsOf`: `data` / `items` / `rows` / none — the fourth branch is new and is the
  entire Budgets fix.
- `useCollection`'s filter/search/sort/slice pipeline, extracted as a pure
  function so it can be tested without a hook harness.
- Money and duration formatting from decimal **strings** (no float round-trip);
  `2h 30m` from 150.

**Behaviour**
- `DataWindow`: clicking a sideNav item patches props and swaps the pane;
  breadcrumb follows; unknown persisted domain falls back without a blank render.
- Section switch unmounts the previous table (assert the previous fetch is not
  re-issued and selection is cleared).
- Admin-only sections absent for `role: "user"`, present for `role: "admin"`.
- Scoped section: renders the picker and issues **no request** until a project is
  chosen.
- Preferences: toggling a `Switch` PUTs once and rolls back on failure; a
  mandatory row's switch is disabled.
- Transactions: no Edit item in the row menu; the status actions offered match the
  row's current status.
- Knowledge: a 409 on save renders the conflict message, not a generic error.
- `deleteKey`: the confirm dialog deletes by email / userId / preference key.

**Cannot be unit-tested; verify signed in** (Phase 4's `items` bug is the
precedent — every fixture used the shape the code expected):
- Every list endpoint's actual envelope, per §6.1's table.
- That `/finance/budgets` really returns `rows` and the pager agrees with it.
- Knowledge's `total` vs `totalBeforeAccess` on a non-admin account.
- A scoped section against a project the principal is only a `viewer` on.

---

## 13. Build order

Each increment ends with the app working.

**5a — the shell.** `data-window.tsx`, `domain-nav.tsx`, `section-tabs.tsx`,
`registry.ts` with two domains (Contacts, Files) wired to the configs that already
exist. `patchWindowProps`. Retire the two window kinds, add `data`, add the
ShellChrome button. Result: the Phase-4 tables are reachable for the first time.

**5b — the data layer.** `rowsOf` gains `rows`; `useCollection`; `useLookup`;
`keys`/`fetcher` cases; `source`, `deleteKey`, row-level `canEdit`/`canDelete`,
async filters. No new domains yet — this is the plumbing 5c depends on, and it is
independently testable.

**5c — the domains.** Knowledge, Projects, Notifications, Finance, You, in that
order: increasing order of how much new interaction each needs. Finance last
because Reports is the only non-table section and the verb actions are densest.
Each domain is one config file plus a registry entry.

**5d — record relations.** `RecordFormSpec.relations` and tabbed record windows
(§8.5). Invoice detail (lines + payments) is the pilot.

---

## 14. Backend asks

Not blocking — each has a client-side workaround above — but each costs the client
code it should not need.

1. **Four spellings of "the rows."** `data` (11 endpoints), `items` (`/files`),
   `rows` (`/finance/budgets`), and a naked server-sliced array with no total
   (`/system/notifications/suppressions`). Hoist one shared `Paginated<T>` and
   normalise. Phase 4 raised this for `items`; these are instances two and three,
   and the suppressions one is a correctness bug on the backend's own terms — it
   takes a `page` parameter it gives the caller no way to use.
2. **`GET /me/permissions`** — effective permission keys for the caller.
   Today `/authorization/users/:userId/effective` requires `rbac.manage`, so no
   ordinary user can read their own. Until it exists, `DomainTableConfig.permissions`
   cannot be enforced and every action is optimistic (§9).
3. **Batch label resolution** — `GET /contacts?ids=a,b,c` (and the same for
   `/projects`, `/users`). Reference columns currently pull the first 100 rows of
   the parent collection and degrade past that (§6.3).
4. **`GET /notifications/:id`** — the list has no item endpoint, so the detail
   window must be seeded from the row (§7.4).
5. **Read state on notifications** — `status` is delivery state, not a read
   receipt. There is nothing to build an unread badge from.
6. **`GET /finance/recurring?activeOnly=false`** — the service takes the parameter
   (`recurring.service.ts:65`), the controller does not pass it, so inactive
   schedules are unreachable.
7. **Unscoped milestones/goals** — `GET /milestones?projectId=` would let those
   sections behave like every other list instead of needing a scope picker.
   (Goals already accept a null project internally: `listGoals(projectId: string |
   null)`.)
