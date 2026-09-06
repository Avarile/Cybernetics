# Client State Architecture — Design

**Date:** 2026-09-06
**Branch:** feat-feature-popups
**Status:** Approved design (not yet built)
**Scope:** `client/` — the whole state layer
**Supersedes:** the ad-hoc state layer described in §2

---

## 1. Goal

Rebuild the client's state management on two explicitly-separated mechanisms:

- **SWR** owns every value the **server** is the source of truth for.
- **Zustand** (with `persist` + `immer`) owns every value the **client** is the source of
  truth for.

The result must be modular — each unit answers "what does it do, how do you use it, what
does it depend on" without reading its internals — and must present a hook-shaped facade
that UI components can consume as pure functions of props and hook returns.

Four confirmed defects are fixed as a consequence of the structure, not patched
alongside it (§11).

---

## 2. The problem this replaces

The current layer works, and several parts of it are genuinely well-built (the
single-flight refresh latch, the pure SSE reducer, the two-band z-index model, the
versioned window persistence). But it has no server-state layer at all, and the gap shows
up as five recurring costs:

| Cost | Where it shows |
|---|---|
| Every server read is a hand-rolled `useState` + `useEffect` + race guard | `use-domain-table.ts:52-88`, `record-window.tsx:57-80`, `use-agent-chat.ts:36-68` |
| Invalidation is a `refreshToken: number` prop, so it only reaches one component | `files-window.tsx:16`, `contacts-window.tsx:11` |
| Cross-window invalidation is impossible | two open Contacts windows never agree |
| Server data lives in stores, so sign-out leaks it | `conversation.store.reset()` is called only from tests |
| Callbacks travel inside persisted window props | `contacts-window.tsx:52` puts a closure in `WindowInstance.props` |

The redesign removes the *category* of each, rather than the instance.

---

## 3. Decision

**Approach A — strict separation with a feature-hook facade.**

> Server truth never lives in Zustand. Client truth never lives in SWR.
> Components never import a store or a cache key; they import a feature hook.

### Rejected alternatives

**B — Zustand of everything, SWR as transport.** SWR fetches and writes results into
stores via `onSuccess`; components read only stores. One read path, familiar shape. Rejected
because it reintroduces two sources of truth for the same value, a frame of skew between
them, and manual staleness tracking — the argument the codebase already makes against
itself in `components/system-core/hooks/useLive.ts:4-12`.

**C — Approach A plus a normalized entity cache.** Buys cross-list consistency (editing a
contact in a detail window updating the row in a list window without a refetch). No current
use case justifies the machinery. YAGNI; prefix invalidation covers the real need.

---

## 4. Dependencies

| Package | Version | Why |
|---|---|---|
| `swr` | `^2.5.1` | server-state cache, dedupe, revalidation, filtered `mutate` |
| `immer` | `^11.1.18` | peer dependency of `zustand/middleware/immer` |

`zustand@5.0.15` is already installed; `persist` and `immer` middleware ship inside it.

No other dependency is added or removed. `lib/api/client.ts` is *not* replaced — SWR sits
above it.

---

## 5. Architecture — four rings

```
Ring 3  UI          app/**  components/**
                    May import: features/**, lib/ui, lib/utils, lib/windows/meta
                    May NOT import: stores/**, swr, lib/api/**

Ring 2  Features    features/**
                    Hooks that compose Ring 1 into one API per feature.
                    The only public surface the UI is allowed to touch.

Ring 1  State       stores/**          client truth  (zustand + persist + immer)
                    lib/swr/**         server truth  (SWR keys, fetcher, invalidation)

Ring 0  Transport   lib/api/**         ApiClient, error envelopes, endpoint fns
                    Unchanged, except that onAuthFailure becomes injected (§6.4).
```

Dependencies point inward only. Ring 0 knowing about Ring 1 is the one edge that exists
today (`lib/api/provider.tsx:5` imports the window store) and it is cut in §6.4.

### 5.1 File inventory

```
client/
  lib/
    api/                          UNCHANGED  client.ts, errors.ts, types.ts, endpoints/*
    swr/
      keys.ts             NEW     the key registry — the only place a key is spelled
      match.ts            NEW     prefix matcher for invalidation           [pure]
      fetcher.ts          NEW     createFetcher(client): tuple key -> request
      provider.tsx        NEW     <StateProvider> — ApiProvider + SWRConfig + reset wiring
      use-invalidate.ts   NEW     useInvalidate(): (prefix) => Promise<void>
    windows/
      meta.ts             NEW     WINDOW_META — pure descriptor data, no components
      registry.tsx        CHANGED WINDOW_COMPONENTS — lazy bodies only
      types.ts            CHANGED props: JsonObject; WindowInstance carries minSize
      geometry.ts         UNCHANGED
    state/
      store-factory.ts    NEW     createPersistedStore() — persist(immer(...)) + legacy storage
      legacy-storage.ts   NEW     one-time readers for cyb.refresh / cyb.windows   [pure]
      reset.ts            NEW     resetClientState() — the single sign-out choke point
      json.ts             NEW     JsonValue / JsonObject types

  stores/
    session.store.ts      RENAMED from auth.store.ts   — tokens only, principal removed
    workspace.store.ts    RENAMED from window.store.ts — + scene-control slice
    viewport.store.ts     NEW     not persisted; kills the resize write storm
    turn.store.ts         RENAMED from conversation.store.ts — server data removed
    upload.store.ts       CHANGED immer

  features/
    session/
      use-session.ts             principal + authed/settling, from SWR
      use-session-bootstrap.ts   refresh-token exchange on boot
      use-auth-gate.ts           derives the auth modal
      use-sign-in.ts             login / register / sign-out commands
    workspace/
      use-workspace.ts           open windows, dock, scrim, viewport sync
      use-window-controls.ts     per-window close/focus/minimise/maximise/move
      use-workspace-persistence.ts
      use-scene-controls.ts      panel / scanner / reset  (§9.3)
    agent/
      use-conversations.ts       SWR rail
      use-messages.ts            SWR history + optimistic merge
      use-agent-chat.ts          streaming turn orchestration
    records/
      use-domain-table.ts        query state (local) + SWR page
      use-record.ts              SWR single record
      use-record-mutations.ts    create / update / delete + invalidation
    files/
      use-file-uploads.ts        upload store + list invalidation
    state-hydration.ts           useStateHydration() — rehydrate before bootstrap
```

---

## 6. Server state — SWR

### 6.1 Key registry

Every key is a **tuple**, and every key is spelled in exactly one file.

```ts
// lib/swr/keys.ts
export const keys = {
  session:       ()                                => ["session"] as const,
  conversations: ()                                => ["conversations"] as const,
  messages:      (id: string)                      => ["conversation", id, "messages"] as const,
  list:          (endpoint: string, q: TableQuery) => ["list", endpoint, serialiseQuery(q)] as const,
  record:        (endpoint: string, id: string)    => ["record", endpoint, id] as const,
} as const
```

Tuples give SWR structural equality without a serialisation step of our own, and they make
the *prefix* meaningful: `["list", "/contacts"]` is a prefix of every page, filter and sort
of that domain.

`serialiseQuery(q)` is a stable, order-independent string built from the same `TableQuery`
that `buildListUrl` consumes, so two structurally identical queries always produce one
cache entry.

### 6.2 Invalidation

```ts
// lib/swr/match.ts  — pure, unit-tested
export function hasPrefix(key: unknown, prefix: readonly unknown[]): boolean

// lib/swr/use-invalidate.ts
export function useInvalidate() {
  const { mutate } = useSWRConfig()
  return useCallback(
    (prefix: readonly unknown[]) => mutate((key) => hasPrefix(key, prefix)),
    [mutate],
  )
}
```

This is the mechanism that replaces the `refreshToken: number` prop protocol **and** the
`onDone` callbacks threaded through window props. A delete in one window refreshes every
open window showing that domain, because they share the key prefix rather than a callback.

### 6.3 Fetcher

```ts
// lib/swr/fetcher.ts
export function createFetcher(client: ApiClient): Fetcher {
  return (key: readonly unknown[]) => resolveKey(client, key)
}
```

`resolveKey` is a small exhaustive switch on `key[0]` mapping a tuple to a request. Keeping
the mapping here — rather than a URL-shaped key — is what allows the key to stay structured
enough to prefix-match while the URL stays the transport's business.

Errors propagate as the existing `ApiError`, so `error instanceof ApiError` narrowing in the
UI is unchanged.

### 6.4 Provider

`<StateProvider>` replaces `<ApiProvider>` in `app/layout.tsx` and composes:

1. the `ApiClient` (memoised as today, reading tokens through `getState()` closures),
2. `SWRConfig` with the bound fetcher and these defaults:
   `revalidateOnFocus: false`, `shouldRetryOnError: false`, `dedupingInterval: 2000`,
   `keepPreviousData: true`,
3. the wiring of `onAuthFailure` → `resetClientState()`.

`shouldRetryOnError: false` is deliberate: `client.ts` already owns the only retry that
matters (the single 401→refresh→retry), and SWR retrying on top of it would multiply
requests against a rotating-refresh backend that treats concurrency as theft.

`onAuthFailure` is now **passed in** by the provider rather than reaching into a store from
`lib/api/`, cutting the Ring 0 → Ring 1 edge.

---

## 7. Client state — Zustand

### 7.1 Store table

| Store | State | Persisted | Immer |
|---|---|---|---|
| `session.store` | `accessToken`, `refreshToken`, `refreshing` | `refreshToken` only | ✓ |
| `workspace.store` | `windows`, `zSeq`, scene controls | `windows`, `zSeq` | ✓ |
| `viewport.store` | `{ w, h }` | — | — |
| `turn.store` | `activeId`, `turn`, `optimistic[]` | — | ✓ |
| `upload.store` | `items[]` | — | ✓ |

Immer is applied to every store with nested state, and to `session.store` too despite its
flat shape, so there is one authoring idiom rather than two.

### 7.2 `createPersistedStore`

```ts
// lib/state/store-factory.ts
createPersistedStore<T>(initializer, {
  name,              // storage key
  version,           // schema version
  partialize,        // what is written
  migrate,           // version upgrades
  legacy,            // one-time reader for a pre-persist payload  (§7.4)
})
```

Wraps `create<T>()(persist(immer(initializer), { ..., skipHydration: true }))`. Every
persisted store goes through it, so versioning and legacy handling cannot be forgotten
per-store.

### 7.3 Why `viewport` is its own store

Verified in `zustand/esm/middleware.mjs:366`: `persist` overrides `setState` to call
`setItem()` **after every set**, with no diff against `partialize` output. Adding `persist`
to the current window store would therefore serialise and write the entire window array on
every `setViewport` — and `WindowLayer` wires `setViewport` straight to the `resize` event.

Viewport is environment, not workspace. It moves to its own non-persisted store, read
cross-store via `useViewportStore.getState()` by `openWindow` / `moveWindow` in keeping with
the existing convention. The resize listener is additionally rAF-throttled.

### 7.4 Legacy storage migration

The current payloads are not `persist` envelopes, so `persist`'s own `migrate` cannot see
them. Each persisted store gets a `PersistStorage` adapter whose `getItem`:

1. returns the `persist` envelope if one exists;
2. otherwise reads the legacy key, converts it, writes the new envelope, removes the legacy
   key, and returns the converted value;
3. otherwise returns `null`.

| Store | Legacy key | Legacy shape |
|---|---|---|
| `session.store` | `cyb.refresh` | a bare refresh-token string |
| `workspace.store` | `cyb.windows` | `{ version: 1, windows: WindowInstance[] }` |

Without this, deploying the redesign signs out every active user. The converters are pure
and unit-tested against both the legacy and the corrupt-input cases.

The existing `isRestorable` validation is kept and moved into the workspace converter: a
window whose `kind` is no longer registered is still dropped rather than restored into a
layer that renders nothing for it.

### 7.5 Hydration order

`skipHydration: true` on both persisted stores avoids an SSR/client mismatch, and makes
rehydration an explicit step:

```ts
// features/state-hydration.ts
export function useStateHydration(): boolean   // false until both stores have rehydrated
```

`CoreShell` runs `useStateHydration()` first and the session bootstrap is gated on it. This
replaces the comment at `core-shell.tsx:16-21` ("Order is load-bearing") with a real
dependency that a test can assert.

---

## 8. Session — the largest semantic change

`principal` **leaves the store** and becomes an SWR resource.

```ts
// features/session/use-session.ts
const token = useSessionStore((s) => s.accessToken)
const { data: principal, isLoading } = useSWR(token ? keys.session() : null, fetcher)

return {
  principal: principal ?? null,
  authed:    Boolean(token && principal),
  settling:  refreshing || (Boolean(token) && isLoading),
}
```

Three things fall out:

1. **The `AuthStatus` machine disappears.** `idle | loading | ready | error` was a manual
   mirror of what SWR already tracks. What remains is `refreshing`, which SWR cannot know
   about because the refresh exchange happens below it.

2. **The auth gate stops needing a `getState()` escape hatch.** `use-auth-window.ts:38-42`
   currently re-reads `status` fresh because the render-time capture is stale within the
   same commit. `settling` is derived from SWR state that is correct *during* the render, so
   `use-auth-gate.ts` becomes honest derivation:

   ```ts
   if (settling) return           // never flash the gate at a returning user
   authed ? closeGate() : openGate()
   ```

3. **`selectIsAuthenticated` keeps its meaning** (a token *and* a principal), so the
   invariant that `RegisterPane` documents at `register-pane.tsx:37-39` survives — but it is
   now enforced by construction rather than by remembering to call `setPrincipal`.

### 8.1 Sign-out

```ts
// lib/state/reset.ts
export function resetClientState(cache: Cache): void
```

Clears `session`, `workspace`, `turn` and `upload` stores, and evicts the entire SWR cache.
Called from exactly two places: the sign-out command and `onAuthFailure`. This is defect #3.

---

## 9. Workspace

### 9.1 Split registry

`lib/windows/registry.tsx` currently mixes descriptor metadata with lazy component imports,
which is why the store cannot read it without pulling React components into Ring 1.

```
lib/windows/meta.ts        WINDOW_META: Record<WindowKind, WindowMeta>
                           title, icon, singleton, modal, defaultRect, minSize
lib/windows/registry.tsx   WINDOW_COMPONENTS: Partial<Record<WindowKind, Lazy<WindowBody>>>
```

`openWindow(kind, overrides?)` resolves `WINDOW_META[kind]` for title, modal, singleton and
`defaultRect`; `minSize` is carried on `WindowInstance` and forwarded by `WindowFrame` into
`useDragResize`. Call sites stop repeating `modal: true` and stop being able to disagree
with the registry. This is defect #1.

A kind present in `WINDOW_META` but absent from `WINDOW_COMPONENTS` still renders nothing,
preserving the "declare a kind ahead of its implementation" property.

### 9.2 JSON-safe props

`WindowInstance.props` is typed `JsonObject`. This is only possible because §6.2 removed the
last callback prop (`onDone`), and it converts a silent `JSON.stringify` drop into a compile
error.

### 9.3 Scene controls

`panelOpen`, `scannerVisible` and `resetToken` move from `CoreShell` `useState` into a
non-persisted slice of `workspace.store`, exposed by `features/workspace/use-scene-controls.ts`.
`ShellChrome` and `SystemCoreCanvas` read the hook instead of receiving five props.

**Separable:** this section is the one piece not required by the goal or the defects. Cutting
it means deleting the slice and `use-scene-controls.ts` and leaving `CoreShell` as it is;
nothing else in the design depends on it.

---

## 10. Feature redesigns

### 10.1 Agent

`conversation.store` splits along the truth boundary:

| Was | Becomes |
|---|---|
| `conversations`, `conversationsStatus/Error` | `useConversations()` — SWR |
| `messages`, `messagesStatus/Error` | `useMessages(activeId)` — SWR |
| `activeId`, `turn` | `turn.store` |
| `appendUserMessage` | `turn.store.optimistic[]`, merged in `useMessages` |

`lib/agent/reducer.ts` is **unchanged** — it is the best-factored file in the client and the
redesign exists partly to let more code look like it.

`useMessages(id)` returns `[...swrHistory, ...optimistic, inFlightTurn]`, composed with
`useMemo`. The documented `buildVisibleMessages` trap survives as a comment on that memo: it
builds a new object per call and must never become a subscription selector.

A brand-new conversation has `activeId === null`, so the SWR key is `null` and nothing is
fetched; the turn's `start` frame mints the id, `activeId` is set, the key materialises, and
`settleTurn` revalidates it. `useAgentChat`'s `finally` block replaces
`void loadConversations()` with `invalidate(keys.conversations())`.

### 10.2 Records / data-table

`useDomainTable` keeps `TableQuery` in local `useState` — it is per-window client state and
correctly local. Only the fetch moves:

```ts
const { data, error, isLoading } = useSWR(keys.list(config.endpoint, query), fetcher)
```

The `requestSeq` out-of-order guard (`use-domain-table.ts:49-50`) is **deleted**: SWR keys
requests by identity, so a stale response cannot land in a newer key's slot. `keepPreviousData`
covers the pagination flicker the guard was also incidentally smoothing.

`useRecordMutations(endpoint)` exposes `create`, `update`, `remove`, each invalidating
`["list", endpoint]` and, where relevant, `["record", endpoint, id]`. `RecordWindow` and
`ConfirmWindow` call it and take no callback props. This is defect #2.

`ConfirmWindow` keeps its per-id `Promise.allSettled` and its honest partial-failure
reporting — that behaviour is correct and is not part of this change.

### 10.3 Uploads

`upload.store` gains immer and otherwise keeps its shape and its 7-phase machine. The one
change: `use-file-uploads.ts` invalidates `["list", "/files"]` when an item reaches
`indexed`, replacing `FilesWindow`'s `refreshToken` counter.

---

## 11. Defect fixes

| # | Defect | Fixed by | Kind |
|---|---|---|---|
| 1 | `defaultRect` / `minSize` / `singleton` declared but never read; every window opens 900×600 | §9.1 — `openWindow` resolves `WINDOW_META`; `minSize` reaches `useDragResize` | structural |
| 2 | Contacts create/edit and Files delete leave the table stale | §6.2 + §10.2 — prefix invalidation replaces `onDone` | structural |
| 3 | `turn` / `upload` state survives sign-out into the next user's session | §8.1 — `resetClientState()` at two choke points | structural |
| 4 | Unthrottled `localStorage` write of the whole window array per resize event | §7.3 — viewport leaves the persisted store; listener rAF-throttled | structural |
| 5 | Closures in window props drop silently through `JSON.stringify` | §9.2 — `props: JsonObject` (possible only after #2) | bonus |

---

## 12. Enforcement

`eslint.config.mjs` gains a `no-restricted-imports` zone for `components/**` and `app/**`:

| Banned | Use instead |
|---|---|
| `@/stores/*` | a `features/**` hook |
| `swr` | a `features/**` hook |
| `@/lib/api/*` | a `features/**` hook |

`features/**`, `stores/**` and `lib/**` are exempt. This is what makes the UI layer
mockable without a container/presenter split: a component's entire data dependency is the
set of feature hooks it calls, and each is a single module to stub.

---

## 13. Testing

Vitest + jsdom + Testing Library, TDD, following the repo's existing habit of testing the
pure core hardest.

**Pure units (no React):**
`match.hasPrefix`, `keys.serialiseQuery`, both legacy-storage converters, `omitBlank`,
`buildListUrl` / `clampPage` / `pageCount` (unchanged), `geometry` (unchanged),
`reducer` (unchanged).

**Store units:** one file per store, driving actions through `getState()` and asserting
state — the shape the four existing store tests already use, migrated.

**Feature hooks:** `renderHook` wrapped in `SWRConfig` with `provider: () => new Map()` and
a stub fetcher, so each test gets an isolated cache. Asserted behaviours include:
optimistic-then-settled message merge, invalidation reaching a second subscriber of the same
prefix, and the gate not flashing while `settling`.

**Rewritten** (behaviour changes): `use-auth-window.test.tsx`, `auth-window.test.tsx`,
`terminal-window.test.tsx`, `conversation.store.test.ts`, `auth.store.test.ts`,
`window.store.test.ts`, `use-window-persistence.test.ts`.

**Updated** (harness only — these wrap in `ApiProvider`, which becomes `StateProvider` with
a per-test SWR cache): `data-table.test.tsx`, `window-layer.test.tsx`. Their assertions are
kept as-is; only the wrapper changes.

**Unchanged:** `geometry.test.ts`, `reducer.test.ts`, `sse.test.ts`, `sse.contract.test.ts`,
`stream.test.ts`, `errors.test.ts`, `client.test.ts`, `upload.test.ts`, `query.test.ts`,
`use-drag-resize.test.ts`, `window-frame.test.tsx`, `theme-provider.test.tsx`,
`sanity.test.ts`.

The full suite must pass before and after each phase of the implementation plan.

---

## 14. Out of scope

- Normalized entity cache (§3, alternative C).
- `devtools` middleware.
- Persisting table query, UI preferences, or last-active conversation — the persistence
  surface stays exactly what it is today: refresh token, window layout, theme.
- Container/presenter split of UI components.
- Any change to `lib/api/client.ts`'s refresh semantics, `lib/agent/*`, `lib/files/upload.ts`,
  `components/ui/**`, `components/ai-elements/**`, or `components/system-core/**`
  (beyond `SystemCoreCanvas` reading `use-scene-controls`).
- `next-themes` — theme state is already a solved, separate concern.

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Legacy migration bug signs out every active user | §7.4 converters are pure and tested against legacy, missing, and corrupt payloads before anything else is built |
| SWR retry stacking on the refresh latch causes token-family revocation | `shouldRetryOnError: false` (§6.4), asserted in a provider test |
| Hydration ordering regression reintroduces the login-dialog flash | `useStateHydration()` gates the bootstrap; the flash case is an existing test that is kept |
| Large rename surface (`auth.store` → `session.store`, etc.) obscures behavioural changes in review | implementation plan sequences renames as their own commits, separate from behaviour |
| `principal` moving to SWR changes when `authed` flips | `authed` keeps its exact definition (token **and** principal); covered by the rewritten gate tests |
