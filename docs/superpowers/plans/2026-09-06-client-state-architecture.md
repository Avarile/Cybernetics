# Client State Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `client/`'s state layer so SWR owns all server truth, Zustand (with `persist` + `immer`) owns all client truth, feature hooks are the only surface the UI touches, and five confirmed defects disappear structurally.

**Architecture:** Four rings — UI (`app/`, `components/`) → Features (`features/`) → State (`stores/`, `lib/swr/`) → Transport (`lib/api/`). Dependencies point inward only. Server data never enters a store; client data never enters the SWR cache. Cross-component invalidation happens by tuple-key prefix instead of `refreshToken` counters and callback props.

**Tech Stack:** Next.js 16 (App Router), React 19.2, TypeScript 5, SWR 2.5, Zustand 5.0.15 (`persist` + `immer` middleware), immer 11, Vitest 5 + jsdom + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-06-client-state-architecture-design.md`

## Global Constraints

- All work happens inside `client/`. Run every command from `client/`.
- Package manager: **`pnpm`**. `client/pnpm-lock.yaml` and `client/pnpm-workspace.yaml` are git-tracked, `api/package.json` pins `packageManager: pnpm@10.16.1`, and `.github/workflows/typecheck.yml` runs `pnpm install --frozen-lockfile` then `pnpm typecheck`. There is no `package-lock.json` and there never has been. **Never run `npm` in this repo** — it crashes inside `@npmcli/arborist` on the pnpm `node_modules` layout. Use `pnpm add`, `pnpm test`, `pnpm run <script>`, `pnpm exec vitest`. Stage `pnpm-lock.yaml`, never a `package-lock.json`.
- Exact adds: `swr@^2.5.1`, `immer@^11.1.18`. No other dependency is added or removed.
- Path alias is `@/*` → `client/*` (both `tsconfig.json` and `vitest.config.ts`).
- Test command: `pnpm test` (full suite) or `pnpm exec vitest run <path>` (one file). `pnpm run typecheck` must pass at the end of every task.
- **Lint has a failing pre-existing baseline** and cannot be made to pass by this plan: 44 problems (30 errors, 14 warnings) across 26 files, all in vendored or ported code — `components/ai-elements/**`, `components/system-core/**`, `components/ui/carousel.tsx`, `hooks/use-mobile.ts`. Fixing them is out of scope. The bar is therefore **introduce no new lint problems**: after your change, `pnpm run lint 2>&1 | tail -1` must still report no more than `44 problems (30 errors, 14 warnings)`, and no file you created may appear in the output. `components/system-core/system-core-canvas.tsx` is already in the failing set and is touched by Task 20 — for that file, its existing problem count must not grow.
- Code style: double quotes, no semicolons, 2-space indent, `prettier-plugin-tailwindcss`. Match the surrounding file.
- Comments explain **why**, never what. The existing codebase's comment density is the target — see `stores/window.store.ts` for the house style.
- **Never** subscribe to a Zustand selector that builds a new object or array per call without `useShallow`; under Zustand v5 this fails the `getSnapshot` identity check and re-renders forever. This is a live trap documented at `components/windows/window-layer.tsx:16-18`.
- The API client reads tokens through `getState()` closures, never hook subscriptions, so it always sees the current token without re-creating itself. Preserve this.
- `lib/api/client.ts` is not modified by this plan. Its single-flight refresh latch is correctness-critical (the backend treats two concurrent refreshes as token theft).
- Each task ends with a commit. Commit messages: `feat:`, `refactor:`, `fix:`, `test:`, `chore:`.

## Deviations from the spec (deliberate, approved at plan time)

1. Spec §5.1 lists `lib/state/store-factory.ts` as a generic store factory. Generic Zustand middleware typing (`persist(immer(...))` behind one generic wrapper) requires unsound casts. Instead, `lib/state/persist-storage.ts` exports only the storage adapter, and each store composes `create<T>()(persist(immer(fn), {...}))` itself. Same behaviour, honest types.
2. Spec §9.3 puts the scene controls in a `workspace.store` slice. Because `persist` writes on **every** `setState`, a scene toggle would rewrite the window array. They get their own non-persisted `stores/scene.store.ts` instead.

---

## File Structure

```
lib/swr/
  keys.ts              Tuple key registry. Every key spelled once. Owns URL construction.
  match.ts             hasPrefix() — pure prefix matcher for invalidation.
  fetcher.ts           createFetcher(client) — exhaustive key→request switch.
  use-invalidate.ts    useInvalidate() — prefix-scoped mutate.
  provider.tsx         <StateProvider> — ApiClient + SWRConfig + auth-failure bridge.

lib/state/
  json.ts              JsonValue / JsonObject.
  legacy-storage.ts    Pure converters for the pre-persist localStorage payloads.
  persist-storage.ts   createLegacyAwareStorage() — PersistStorage that upgrades legacy keys.
  reset.ts             resetClientState() — the single sign-out choke point.

lib/windows/
  meta.ts              WINDOW_META — pure descriptor data (no React components).
  registry.tsx         WINDOW_COMPONENTS — lazy bodies only.
  types.ts             + JsonObject props, + minSize on WindowInstance.

stores/
  session.store.ts     accessToken, refreshToken, refreshing.  persist: refreshToken.
  workspace.store.ts   windows, zSeq.                          persist: both.
  viewport.store.ts    { w, h }.                               not persisted.
  scene.store.ts       panelOpen, scannerVisible, resetToken.  not persisted.
  turn.store.ts        activeId, turn, optimistic[].           not persisted.
  upload.store.ts      items[].                                not persisted.

features/
  state-hydration.ts             useStateHydration(): boolean
  session/    use-session.ts · use-session-bootstrap.ts · use-auth-gate.ts · use-sign-in.ts
  workspace/  use-workspace.ts · use-window-controls.ts · use-scene-controls.ts
  agent/      use-conversations.ts · use-messages.ts · use-agent-chat.ts
  records/    use-domain-table.ts · use-record.ts · use-record-mutations.ts
  files/      use-file-uploads.ts
```

---

# Phase A — Pure foundations

## Task 1: Dependencies and the key registry

**Files:**
- Modify: `client/package.json`
- Create: `client/lib/swr/match.ts`
- Create: `client/lib/swr/keys.ts`
- Test: `client/lib/swr/match.test.ts`, `client/lib/swr/keys.test.ts`

**Interfaces:**
- Consumes: `buildListUrl`, `TableQuery`, `TabSpec` from `@/components/data-table/query` and `@/components/data-table/types` (both unchanged).
- Produces:
  - `hasPrefix(key: unknown, prefix: readonly unknown[]): boolean`
  - `keys.session(): readonly ["session"]`
  - `keys.conversations(page?: number, limit?: number): readonly ["conversations", string]`
  - `keys.messages(id: string): readonly ["conversation", string, "messages"]`
  - `keys.list(endpoint: string, query: TableQuery, tabs?: TabSpec[]): readonly ["list", string, string]`
  - `keys.record(endpoint: string, id: string): readonly ["record", string, string]`

- [ ] **Step 1: Install the two dependencies**

```bash
cd client
pnpm add swr@^2.5.1 immer@^11.1.18
```

- [ ] **Step 2: Write the failing test for the prefix matcher**

Create `client/lib/swr/match.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { hasPrefix } from "./match"

describe("hasPrefix", () => {
  it("matches an exact key", () => {
    expect(hasPrefix(["list", "/contacts", "/contacts?page=1"], ["list", "/contacts", "/contacts?page=1"])).toBe(true)
  })

  it("matches a shorter prefix", () => {
    expect(hasPrefix(["list", "/contacts", "/contacts?page=2"], ["list", "/contacts"])).toBe(true)
  })

  it("rejects a different domain under the same head", () => {
    expect(hasPrefix(["list", "/files", "/files?page=1"], ["list", "/contacts"])).toBe(false)
  })

  it("rejects a prefix longer than the key", () => {
    expect(hasPrefix(["list"], ["list", "/contacts"])).toBe(false)
  })

  it("rejects non-array keys, which SWR also stores", () => {
    expect(hasPrefix("session", ["session"])).toBe(false)
    expect(hasPrefix(null, ["session"])).toBe(false)
  })

  it("matches an empty prefix against any array key", () => {
    expect(hasPrefix(["anything"], [])).toBe(true)
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm exec vitest run lib/swr/match.test.ts`
Expected: FAIL — `Failed to resolve import "./match"`.

- [ ] **Step 4: Implement the matcher**

Create `client/lib/swr/match.ts`:

```ts
/**
 * Whether an SWR cache key starts with the given tuple.
 *
 * Invalidation is expressed as a prefix — `["list", "/contacts"]` reaches every
 * page, filter and sort of that domain — which is what lets one window's delete
 * refresh another window showing the same list. Non-array keys are rejected
 * rather than coerced: SWR's cache also holds its own internal string keys, and
 * a loose match there would evict them.
 */
export function hasPrefix(key: unknown, prefix: readonly unknown[]): boolean {
  if (!Array.isArray(key)) return false
  if (prefix.length > key.length) return false
  return prefix.every((part, i) => Object.is(part, key[i]))
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run lib/swr/match.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing test for the key registry**

Create `client/lib/swr/keys.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { initialQuery } from "@/components/data-table/query"
import { keys } from "./keys"
import { hasPrefix } from "./match"

describe("keys", () => {
  it("gives the session a stable single-segment key", () => {
    expect(keys.session()).toEqual(["session"])
  })

  it("carries the fetchable url in the conversations key", () => {
    expect(keys.conversations()).toEqual(["conversations", "/agent/conversations?page=1&limit=20"])
  })

  it("keys messages by conversation id", () => {
    expect(keys.messages("c1")).toEqual(["conversation", "c1", "messages"])
  })

  it("produces an identical key for an identical query", () => {
    const q = initialQuery()
    expect(keys.list("/contacts", q)).toEqual(keys.list("/contacts", { ...q }))
  })

  it("produces different keys for different pages", () => {
    const q = initialQuery()
    expect(keys.list("/contacts", q)).not.toEqual(keys.list("/contacts", { ...q, page: 2 }))
  })

  it("shares a prefix across every page of one domain", () => {
    const q = initialQuery()
    expect(hasPrefix(keys.list("/contacts", { ...q, page: 7 }), ["list", "/contacts"])).toBe(true)
  })

  it("keeps domains apart under the list prefix", () => {
    const q = initialQuery()
    expect(hasPrefix(keys.list("/files", q), ["list", "/contacts"])).toBe(false)
  })

  it("keys a record by endpoint and id", () => {
    expect(keys.record("/contacts", "abc")).toEqual(["record", "/contacts", "abc"])
  })
})
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `pnpm exec vitest run lib/swr/keys.test.ts`
Expected: FAIL — `Failed to resolve import "./keys"`.

- [ ] **Step 8: Implement the key registry**

Create `client/lib/swr/keys.ts`:

```ts
import { buildListUrl, type TableQuery } from "@/components/data-table/query"
import type { TabSpec } from "@/components/data-table/types"

/**
 * Every SWR cache key in the app, spelled exactly once.
 *
 * Keys are tuples rather than strings for two reasons: SWR compares them
 * structurally, so no serialisation step of our own is needed, and a tuple has a
 * meaningful *prefix* — which is how `useInvalidate` reaches every page of a
 * domain without knowing which pages are cached.
 *
 * Where a key's last segment is a URL, that is deliberate: it makes the key both
 * canonical (one cache entry per distinct request) and directly fetchable, so
 * `createFetcher` never has to rebuild a query it was already handed.
 */
export const keys = {
  session: () => ["session"] as const,

  conversations: (page = 1, limit = 20) =>
    ["conversations", `/agent/conversations?page=${page}&limit=${limit}`] as const,

  messages: (id: string) => ["conversation", id, "messages"] as const,

  list: (endpoint: string, query: TableQuery, tabs?: TabSpec[]) =>
    ["list", endpoint, buildListUrl(endpoint, query, tabs)] as const,

  record: (endpoint: string, id: string) => ["record", endpoint, id] as const,
}

/** Prefixes used for invalidation, so call sites never hand-write a tuple. */
export const scopes = {
  allLists: (endpoint: string) => ["list", endpoint] as const,
  allRecords: (endpoint: string) => ["record", endpoint] as const,
  conversations: () => ["conversations"] as const,
  messages: (id: string) => ["conversation", id] as const,
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm exec vitest run lib/swr/keys.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 10: Verify the whole suite and types are still clean**

Run: `pnpm test && pnpm run typecheck`
Expected: all tests pass, no type errors.

- [ ] **Step 11: Commit**

```bash
git add package.json pnpm-lock.yaml lib/swr/
git commit -m "feat(state): add swr + immer and the tuple key registry"
```

---

## Task 2: Legacy storage converters

The highest-risk item in the whole plan: get this wrong and deploying signs out every active user. It is pure, so it is testable in isolation, and it is built before anything depends on it.

**Files:**
- Create: `client/lib/state/json.ts`
- Create: `client/lib/state/legacy-storage.ts`
- Test: `client/lib/state/legacy-storage.test.ts`

**Interfaces:**
- Produces:
  - `type JsonValue`, `type JsonObject`
  - `readLegacyRefresh(raw: string | null): { refreshToken: string } | null`
  - `readLegacyWindows(raw: string | null, isRestorable: (w: unknown) => boolean): { windows: WindowInstance[]; zSeq: number } | null`

- [ ] **Step 1: Create the JSON types**

Create `client/lib/state/json.ts`:

```ts
/**
 * The shape anything persisted must have.
 *
 * Window props are typed as `JsonObject` so that putting a callback in them is a
 * compile error rather than a silent `JSON.stringify` drop — which is exactly
 * how a restored window would otherwise come back with a missing handler and no
 * error anywhere.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }
```

- [ ] **Step 2: Write the failing test**

Create `client/lib/state/legacy-storage.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { readLegacyRefresh, readLegacyWindows } from "./legacy-storage"

const always = () => true
const never = () => false

describe("readLegacyRefresh", () => {
  it("reads a bare token string", () => {
    expect(readLegacyRefresh("abc.def.ghi")).toEqual({ refreshToken: "abc.def.ghi" })
  })

  it("trims surrounding whitespace", () => {
    expect(readLegacyRefresh("  abc  ")).toEqual({ refreshToken: "abc" })
  })

  it("returns null for nothing stored", () => {
    expect(readLegacyRefresh(null)).toBeNull()
    expect(readLegacyRefresh("")).toBeNull()
    expect(readLegacyRefresh("   ")).toBeNull()
  })

  it("refuses a persist envelope, so a re-read cannot swallow one", () => {
    expect(readLegacyRefresh('{"state":{"refreshToken":"x"},"version":1}')).toBeNull()
  })
})

describe("readLegacyWindows", () => {
  const win = {
    id: "w1",
    kind: "contacts",
    title: "Contacts",
    rect: { x: 0, y: 0, w: 900, h: 600 },
    zIndex: 3,
    state: "normal",
    modal: false,
  }

  it("reads the versioned envelope and derives zSeq from the highest zIndex", () => {
    const raw = JSON.stringify({ version: 1, windows: [win, { ...win, id: "w2", zIndex: 9 }] })
    expect(readLegacyWindows(raw, always)).toEqual({
      windows: [win, { ...win, id: "w2", zIndex: 9 }],
      zSeq: 9,
    })
  })

  it("drops windows the validator rejects", () => {
    const raw = JSON.stringify({ version: 1, windows: [win] })
    expect(readLegacyWindows(raw, never)).toEqual({ windows: [], zSeq: 0 })
  })

  it("returns null for a version it does not understand", () => {
    expect(readLegacyWindows(JSON.stringify({ version: 2, windows: [win] }), always)).toBeNull()
  })

  it("returns null for malformed json rather than throwing", () => {
    expect(readLegacyWindows("{not json", always)).toBeNull()
  })

  it("returns null for nothing stored", () => {
    expect(readLegacyWindows(null, always)).toBeNull()
  })

  it("returns null when windows is not an array", () => {
    expect(readLegacyWindows(JSON.stringify({ version: 1, windows: "nope" }), always)).toBeNull()
  })
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm exec vitest run lib/state/legacy-storage.test.ts`
Expected: FAIL — `Failed to resolve import "./legacy-storage"`.

- [ ] **Step 4: Implement the converters**

Create `client/lib/state/legacy-storage.ts`:

```ts
import type { WindowInstance } from "@/lib/windows/types"

/** The schema version the pre-persist window payload was written with. */
const LEGACY_WINDOW_VERSION = 1

/**
 * Reads the pre-persist `cyb.refresh` payload: a bare token string.
 *
 * A persist envelope is refused explicitly. Without that guard, a future read of
 * the new key through this converter would treat the whole envelope as a token
 * and hand the API a credential that can never work.
 */
export function readLegacyRefresh(raw: string | null): { refreshToken: string } | null {
  if (!raw) return null
  const token = raw.trim()
  if (!token || token.startsWith("{")) return null
  return { refreshToken: token }
}

/**
 * Reads the pre-persist `cyb.windows` payload: `{ version, windows }`.
 *
 * Validation is injected rather than imported so this stays pure and so the
 * registry-membership check lives with the registry. A window whose kind is no
 * longer registered is dropped, not restored into a layer that renders nothing
 * for it — the same rule the old `isRestorable` enforced.
 */
export function readLegacyWindows(
  raw: string | null,
  isRestorable: (w: unknown) => boolean,
): { windows: WindowInstance[]; zSeq: number } | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null) return null
  const envelope = parsed as { version?: unknown; windows?: unknown }
  if (envelope.version !== LEGACY_WINDOW_VERSION) return null
  if (!Array.isArray(envelope.windows)) return null

  const windows = envelope.windows.filter(isRestorable) as WindowInstance[]
  return { windows, zSeq: windows.reduce((max, w) => Math.max(max, w.zIndex), 0) }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec vitest run lib/state/legacy-storage.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/state/
git commit -m "feat(state): add pure converters for the pre-persist storage payloads"
```

---

## Task 3: Legacy-aware persist storage

**Files:**
- Create: `client/lib/state/persist-storage.ts`
- Test: `client/lib/state/persist-storage.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the converter *shape* (`(raw: string | null) => P | null`).
- Produces: `createLegacyAwareStorage<P>(options: { version: number; legacy?: { key: string; read: (raw: string | null) => P | null } }): PersistStorage<P>`

- [ ] **Step 1: Write the failing test**

Create `client/lib/state/persist-storage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createLegacyAwareStorage } from "./persist-storage"

interface Slice {
  token: string
}

const read = (raw: string | null): Slice | null => (raw ? { token: raw } : null)

describe("createLegacyAwareStorage", () => {
  beforeEach(() => localStorage.clear())

  it("returns null when there is nothing stored at all", () => {
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toBeNull()
  })

  it("returns the persist envelope when one exists", () => {
    localStorage.setItem("new", JSON.stringify({ state: { token: "fresh" }, version: 1 }))
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toEqual({ state: { token: "fresh" }, version: 1 })
  })

  it("upgrades a legacy payload, writes the envelope, and removes the legacy key", () => {
    localStorage.setItem("old", "legacy-token")
    const storage = createLegacyAwareStorage<Slice>({ version: 3, legacy: { key: "old", read } })

    expect(storage.getItem("new")).toEqual({ state: { token: "legacy-token" }, version: 3 })
    expect(localStorage.getItem("old")).toBeNull()
    expect(JSON.parse(localStorage.getItem("new")!)).toEqual({ state: { token: "legacy-token" }, version: 3 })
  })

  it("prefers the envelope over a legacy key that somehow still exists", () => {
    localStorage.setItem("old", "stale")
    localStorage.setItem("new", JSON.stringify({ state: { token: "fresh" }, version: 1 }))
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toEqual({ state: { token: "fresh" }, version: 1 })
  })

  it("returns null when the legacy converter rejects the payload", () => {
    localStorage.setItem("old", "")
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toBeNull()
  })

  it("survives corrupt json in the envelope slot", () => {
    localStorage.setItem("new", "{not json")
    const storage = createLegacyAwareStorage<Slice>({ version: 1 })
    expect(storage.getItem("new")).toBeNull()
  })

  it("keeps the legacy key when the envelope write fails", () => {
    localStorage.setItem("old", "legacy-token")
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError")
    })

    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toEqual({ state: { token: "legacy-token" }, version: 1 })

    setItem.mockRestore()
    // The upgrade failed, so the ONLY surviving copy must still be there.
    expect(localStorage.getItem("old")).toBe("legacy-token")
  })

  it("falls back to the legacy payload when the envelope slot is corrupt", () => {
    localStorage.setItem("new", "{not json")
    localStorage.setItem("old", "legacy-token")
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })

    expect(storage.getItem("new")).toEqual({ state: { token: "legacy-token" }, version: 1 })
    expect(localStorage.getItem("old")).toBeNull()
  })

  it("upgrades a JSON-shaped legacy payload sharing the envelope key", () => {
    // The `cyb.windows` case: one key, and the legacy payload parses as JSON.
    // Without a `state` check this returns the legacy object as an envelope and
    // the user's saved layout is silently dropped.
    localStorage.setItem("shared", JSON.stringify({ version: 1, windows: ["w"] }))
    const storage = createLegacyAwareStorage<Slice>({
      version: 1,
      legacy: {
        key: "shared",
        read: (r) => (r ? { token: (JSON.parse(r) as { windows: string[] }).windows[0] } : null),
      },
    })

    expect(storage.getItem("shared")).toEqual({ state: { token: "w" }, version: 1 })
  })

  it("round-trips setItem and removeItem", () => {
    const storage = createLegacyAwareStorage<Slice>({ version: 1 })
    storage.setItem("new", { state: { token: "x" }, version: 1 })
    expect(storage.getItem("new")).toEqual({ state: { token: "x" }, version: 1 })
    storage.removeItem("new")
    expect(storage.getItem("new")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm exec vitest run lib/state/persist-storage.test.ts`
Expected: FAIL — `Failed to resolve import "./persist-storage"`.

- [ ] **Step 3: Implement the storage adapter**

Create `client/lib/state/persist-storage.ts`:

```ts
import type { PersistStorage, StorageValue } from "zustand/middleware"

export interface LegacyAwareStorageOptions<P> {
  /** Written into the envelope so `persist`'s own migrate can take over later. */
  version: number
  legacy?: {
    /** The pre-persist localStorage key. */
    key: string
    /** Pure converter from the legacy payload to the persisted slice. */
    read: (raw: string | null) => P | null
  }
}

/**
 * `persist` storage that upgrades a pre-persist payload exactly once.
 *
 * `persist`'s own `migrate` cannot help here: it runs on an envelope it already
 * parsed, and the legacy payloads are not envelopes at all. So the upgrade has
 * to happen a layer lower, on read.
 *
 * Every access is guarded. localStorage throws in private modes and when the
 * quota is exhausted, and losing a restored layout is never worth breaking the
 * session over.
 */
export function createLegacyAwareStorage<P>(
  options: LegacyAwareStorageOptions<P>,
): PersistStorage<P> {
  function raw(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  function write(key: string, value: StorageValue<P>): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      return true
    } catch {
      // Quota, or a privacy mode that refuses writes.
      return false
    }
  }

  return {
    /** Only a real persist envelope carries `state`. */
    function isEnvelope(text: string): boolean {
      try {
        const parsed = JSON.parse(text)
        return parsed !== null && typeof parsed === "object" && "state" in parsed
      } catch {
        return false
      }
    }

    getItem: (name) => {
      const existing = raw(name)
      if (existing) {
        try {
          const parsed = JSON.parse(existing)
          // Parsing without error is NOT enough. Some callers deliberately use
          // the same string for the legacy and envelope keys (`cyb.windows`),
          // and that legacy payload — `{ version, windows }` — is itself valid
          // JSON. Returning it as an envelope makes `persist` read `.state` as
          // undefined and silently keep the empty initial state, discarding the
          // user's saved layout. Only a real envelope carries `state`.
          if (parsed !== null && typeof parsed === "object" && "state" in parsed) {
            return parsed as StorageValue<P>
          }
        } catch {
          // A hand-edited or truncated envelope. Fall through to the legacy
          // path rather than handing `persist` a broken object.
        }
      }

      if (!options.legacy) return null

      const converted = options.legacy.read(raw(options.legacy.key))
      // `=== null`, not falsy: the contract is `P | null`, and a converter may
      // legitimately produce a falsy-but-valid slice.
      if (converted === null) return null

      const value: StorageValue<P> = { state: converted, version: options.version }
      // Retire the legacy key ONLY once its replacement is actually on disk.
      // Deleting it after a swallowed quota failure would destroy the user's
      // one surviving copy of their refresh token and workspace — strictly
      // worse than never upgrading at all.
      //
      // And ONLY when it differs from the envelope key: some callers (e.g.
      // `cyb.windows`) deliberately reuse the same string for both, so the
      // write above already retired the legacy payload by overwriting it —
      // removing "the legacy key" here would delete the envelope it just wrote.
      if (write(name, value) && options.legacy.key !== name) {
        try {
          localStorage.removeItem(options.legacy.key)
        } catch {
          /* see write() */
        }
      }
      return value
    },

    setItem: (name, value) => {
      // Never clobber a legacy payload that has not been upgraded yet.
      // `skipHydration` means a store can be MUTATED before its first getItem —
      // the auth gate opens on mount long before anything calls rehydrate() —
      // and for a same-key caller like `cyb.windows` that write would replace
      // the user's only copy of their layout with an empty envelope.
      if (options.legacy?.key === name) {
        const existing = raw(name)
        // Only protect data the converter can still USE. A slot holding
        // something neither envelope nor convertible (truncated write, unknown
        // version, hand-edited) has nothing worth saving, and refusing to
        // overwrite it would wedge persistence for that user permanently.
        if (existing && !isEnvelope(existing) && options.legacy.read(existing) !== null) return
      }
      write(name, value)
    },

    removeItem: (name) => {
      try {
        localStorage.removeItem(name)
      } catch {
        /* see write() */
      }
    },
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run lib/state/persist-storage.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/state/persist-storage.ts lib/state/persist-storage.test.ts
git commit -m "feat(state): add legacy-aware persist storage adapter"
```

---

# Phase B — Client stores

## Task 4: Viewport and scene stores

Both are new, tiny, and deliberately **not** persisted. Splitting `viewport` out of the window store is the fix for defect #4: verified at `zustand/esm/middleware.mjs:366`, `persist` overrides `setState` to write after *every* set with no diff against `partialize`, so leaving viewport in the persisted store means serialising the whole window array on every resize event.

**Files:**
- Create: `client/stores/viewport.store.ts`
- Create: `client/stores/scene.store.ts`
- Test: `client/stores/viewport.store.test.ts`, `client/stores/scene.store.test.ts`

**Interfaces:**
- Produces:
  - `useViewportStore` with `{ w: number; h: number; setViewport(v: Viewport): void }`
  - `useSceneStore` with `{ panelOpen: boolean; scannerVisible: boolean; resetToken: number; togglePanel(): void; toggleScanner(): void; resetView(): void; reset(): void }`

- [ ] **Step 1: Write the failing tests**

Create `client/stores/viewport.store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { useViewportStore } from "./viewport.store"

const s = () => useViewportStore.getState()

describe("viewport.store", () => {
  beforeEach(() => s().setViewport({ w: 1440, h: 900 }))

  it("starts at a usable default so SSR never yields a zero viewport", () => {
    expect(s().w).toBeGreaterThan(0)
    expect(s().h).toBeGreaterThan(0)
  })

  it("records a measured viewport", () => {
    s().setViewport({ w: 800, h: 600 })
    expect({ w: s().w, h: s().h }).toEqual({ w: 800, h: 600 })
  })

  it("writes nothing to localStorage", () => {
    localStorage.clear()
    s().setViewport({ w: 640, h: 480 })
    expect(localStorage.length).toBe(0)
  })
})
```

Create `client/stores/scene.store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { useSceneStore } from "./scene.store"

const s = () => useSceneStore.getState()

describe("scene.store", () => {
  beforeEach(() => s().reset())

  it("starts with the panel and scanner on, matching the reference defaults", () => {
    expect(s().panelOpen).toBe(true)
    expect(s().scannerVisible).toBe(true)
  })

  it("toggles the panel", () => {
    s().togglePanel()
    expect(s().panelOpen).toBe(false)
  })

  it("toggles the scanner", () => {
    s().toggleScanner()
    expect(s().scannerVisible).toBe(false)
  })

  it("bumps a token to request a view reset", () => {
    const before = s().resetToken
    s().resetView()
    expect(s().resetToken).toBe(before + 1)
  })

  it("returns to defaults on reset", () => {
    s().togglePanel()
    s().resetView()
    s().reset()
    expect({ panelOpen: s().panelOpen, resetToken: s().resetToken }).toEqual({ panelOpen: true, resetToken: 0 })
  })

  it("writes nothing to localStorage", () => {
    localStorage.clear()
    s().togglePanel()
    expect(localStorage.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm exec vitest run stores/viewport.store.test.ts stores/scene.store.test.ts`
Expected: FAIL — both imports unresolved.

- [ ] **Step 3: Implement the viewport store**

Create `client/stores/viewport.store.ts`:

```ts
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import type { Viewport } from "@/lib/windows/geometry"

interface ViewportState extends Viewport {
  setViewport: (v: Viewport) => void
}

/**
 * The measured window size, kept out of the workspace store on purpose.
 *
 * `persist` writes after every `setState` with no diff against `partialize`
 * (zustand/esm/middleware.mjs:366), and the resize listener fires this many
 * times per drag — so leaving it in the persisted store meant serialising the
 * whole window array per resize event. Viewport is environment, not workspace.
 *
 * The default is a plausible desktop rather than zero: `clampToViewport` runs
 * before the first measurement, and a zero viewport collapses every window.
 */
export const useViewportStore = create<ViewportState>()(
  immer((set) => ({
    w: 1440,
    h: 900,
    setViewport: ({ w, h }) =>
      set((state) => {
        state.w = w
        state.h = h
      }),
  })),
)
```

- [ ] **Step 4: Implement the scene store**

Create `client/stores/scene.store.ts`:

```ts
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

interface SceneState {
  panelOpen: boolean
  scannerVisible: boolean
  /** Bumped to ask the canvas for a camera reset; it has no readable value. */
  resetToken: number
  togglePanel: () => void
  toggleScanner: () => void
  resetView: () => void
  reset: () => void
}

const DEFAULTS = { panelOpen: true, scannerVisible: true, resetToken: 0 }

/**
 * The three System Core viewport controls, previously `useState` in CoreShell
 * and prop-drilled into two children.
 *
 * Not persisted, and deliberately not part of the workspace store: a persisted
 * store writes on every set, and toggling a panel has no business rewriting the
 * window layout.
 */
export const useSceneStore = create<SceneState>()(
  immer((set) => ({
    ...DEFAULTS,
    togglePanel: () =>
      set((state) => {
        state.panelOpen = !state.panelOpen
      }),
    toggleScanner: () =>
      set((state) => {
        state.scannerVisible = !state.scannerVisible
      }),
    resetView: () =>
      set((state) => {
        state.resetToken += 1
      }),
    reset: () => set(() => ({ ...DEFAULTS })),
  })),
)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run stores/viewport.store.test.ts stores/scene.store.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add stores/viewport.store.ts stores/scene.store.ts stores/viewport.store.test.ts stores/scene.store.test.ts
git commit -m "feat(state): add non-persisted viewport and scene stores"
```

---

## Task 5: Rename the window store to workspace (mechanical)

Behaviour-free rename, committed on its own so the behavioural change in Task 6 is reviewable in isolation.

**Files:**
- Rename: `client/stores/window.store.ts` → `client/stores/workspace.store.ts`
- Rename: `client/stores/window.store.test.ts` → `client/stores/workspace.store.test.ts`
- Modify (import + identifier only): `client/lib/api/provider.tsx`, `client/components/shell/shell-chrome.tsx`, `client/components/shell/use-auth-window.ts`, `client/components/windows/window-layer.tsx`, `client/components/windows/dock.tsx`, `client/components/windows/use-window-persistence.ts`, `client/components/windows/confirm-window.tsx`, `client/components/data-table/record-window.tsx`, `client/components/domains/contacts-window.tsx`, `client/components/domains/files-window.tsx`, `client/components/system-core/system-core-canvas.tsx`

- [ ] **Step 1: Rename the files with git so history follows**

```bash
cd client
git mv stores/window.store.ts stores/workspace.store.ts
git mv stores/window.store.test.ts stores/workspace.store.test.ts
```

- [ ] **Step 2: Rename the hook and its module path everywhere**

```bash
grep -rl "stores/window.store\|useWindowStore" --include="*.ts" --include="*.tsx" . \
  | xargs sed -i '' -e 's#stores/window\.store#stores/workspace.store#g' -e 's#useWindowStore#useWorkspaceStore#g'
```

- [ ] **Step 3: Verify nothing was missed**

Run: `grep -rn "useWindowStore\|stores/window.store" --include="*.ts" --include="*.tsx" .`
Expected: no output.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm test && pnpm run typecheck`
Expected: all tests pass unchanged, no type errors. `WINDOW_STORAGE_KEY` is still `"cyb.windows"` — the storage key must not change in this task.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(state): rename window.store to workspace.store"
```

---

## Task 6: Workspace store on persist + immer

Replaces the hand-rolled persistence in `use-window-persistence.ts` and moves `viewport` reads to the new store.

**Files:**
- Modify: `client/stores/workspace.store.ts`
- Modify: `client/stores/workspace.store.test.ts`
- Modify: `client/components/windows/window-layer.tsx:29-35` (viewport sync moves to Task 20's hook; here it just points at the new store)
- Delete: `client/components/windows/use-window-persistence.ts`, `client/components/windows/use-window-persistence.test.ts`
- Modify: `client/app/core/core-shell.tsx` (drop the deleted hook; hydration arrives in Task 14)
- Test: `client/stores/workspace.store.test.ts`

**Interfaces:**
- Consumes: `createLegacyAwareStorage` (Task 3), `readLegacyWindows` (Task 2), `useViewportStore` (Task 4).
- Produces: `useWorkspaceStore` — same action names as before (`openWindow`, `closeWindow`, `focusWindow`, `minimiseWindow`, `restoreWindow`, `toggleMaximise`, `moveWindow`, `closeAll`), minus `setViewport` and `hydrate`. Exports `serialiseForPersist`, `isRestorable`, `selectOpenWindows`, `selectMinimised`, `selectTopModal`, `MODAL_Z_BASE`, `MODAL_SCRIM_Z`, `WORKSPACE_STORAGE_KEY`.

- [ ] **Step 1: Write the failing tests**

Append to `client/stores/workspace.store.test.ts` (keep every existing test — they must still pass):

```ts
describe("workspace.store persistence", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
  })

  it("persists non-modal windows under the new envelope", async () => {
    useWorkspaceStore.getState().openWindow({ kind: "contacts" })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(1)
    expect(stored.state.windows[0].kind).toBe("contacts")
  })

  it("never persists a modal window", async () => {
    // `terminal`, not `auth`: auth is in NEVER_PERSIST, so it would pass this
    // test even if the `!w.modal` clause were deleted from serialiseForPersist.
    useWorkspaceStore.getState().openWindow({ kind: "terminal", modal: true })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(0)
  })

  it("never persists a transient record window", async () => {
    useWorkspaceStore.getState().openWindow({ kind: "record-edit", singletonKey: "x" })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(0)
  })

  it("rehydrates a legacy cyb.windows payload and clears the legacy key", async () => {
    localStorage.setItem(
      "cyb.windows",
      JSON.stringify({
        version: 1,
        windows: [
          {
            id: "w1",
            kind: "contacts",
            title: "Contacts",
            rect: { x: 10, y: 10, w: 400, h: 300 },
            zIndex: 4,
            state: "normal",
            modal: false,
          },
        ],
      }),
    )

    // The legacy reader runs through the store's own storage adapter on the
    // first getItem, which rehydrate() triggers.
    await useWorkspaceStore.persist.rehydrate()

    expect(useWorkspaceStore.getState().windows).toHaveLength(1)
    expect(useWorkspaceStore.getState().zSeq).toBe(4)
    // The slot was rewritten as an envelope, so a second read takes the fast path.
    expect(JSON.parse(localStorage.getItem("cyb.windows")!)).toHaveProperty("state.windows")
  })

  it("clamps against the viewport store rather than its own copy", () => {
    useViewportStore.getState().setViewport({ w: 500, h: 400 })
    const id = useWorkspaceStore.getState().openWindow({ kind: "contacts" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.rect.w).toBeLessThanOrEqual(500)
    expect(win.rect.h).toBeLessThanOrEqual(400)
  })
})
```

Add the imports `useViewportStore` from `./viewport.store` at the top of the test file.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run stores/workspace.store.test.ts`
Expected: FAIL — persisted envelope is not written (the store still has no `persist`).

- [ ] **Step 3: Rewrite the store head with persist + immer**

Replace the store creation in `client/stores/workspace.store.ts`. The action bodies become immer mutations; the module's exported constants and selectors are unchanged except as noted.

```ts
import { nanoid } from "nanoid"
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { immer } from "zustand/middleware/immer"
import { createLegacyAwareStorage } from "@/lib/state/persist-storage"
import { readLegacyWindows } from "@/lib/state/legacy-storage"
import { cascade, clampToViewport } from "@/lib/windows/geometry"
import { useViewportStore } from "./viewport.store"
import type { Rect, WindowInstance, WindowKind } from "@/lib/windows/types"

export const WORKSPACE_STORAGE_KEY = "cyb.windows"

/** Persisted slice. Only the workspace — never in-flight work. */
interface PersistedWorkspace {
  windows: WindowInstance[]
  zSeq: number
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    immer((set, get) => ({
      windows: [],
      zSeq: 0,

      // Today's body, with two changes and no others: the viewport comes from
      // the new store, and the final write is an immer mutation. Descriptor
      // resolution is Task 7's job — do not reach for WINDOW_META here.
      openWindow: (input) => {
        const key = input.singletonKey ?? input.kind
        const existing = get().windows.find((w) => keyOf(w) === key)

        if (existing) {
          get().focusWindow(existing.id)
          if (get().windows.find((w) => w.id === existing.id)?.state === "minimised") {
            get().restoreWindow(existing.id)
          }
          return existing.id
        }

        const id = nanoid()
        const modal = input.modal ?? false
        const viewport = useViewportStore.getState()
        const nextZ = get().zSeq + 1

        const base = clampToViewport({ ...DEFAULT_RECT, ...input.rect }, viewport)
        // An explicit x means the caller placed it; only auto-placed windows cascade.
        const rect = input.rect?.x != null ? base : cascade(get().windows.length, base, viewport)

        const instance: WindowInstance = {
          id,
          kind: input.kind,
          title: input.title ?? input.kind,
          props: { ...input.props, __key: key },
          rect,
          zIndex: modal ? MODAL_Z_BASE + nextZ : nextZ,
          state: "normal",
          modal,
        }

        set((state) => {
          state.windows.push(instance)
          state.zSeq = nextZ
        })
        return id
      },

      closeWindow: (id) =>
        set((state) => {
          state.windows = state.windows.filter((w) => w.id !== id)
        }),

      focusWindow: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (!win) return
          state.zSeq += 1
          win.zIndex = win.modal ? MODAL_Z_BASE + state.zSeq : state.zSeq
        }),

      minimiseWindow: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.state = "minimised"
        }),

      restoreWindow: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.state = "normal"
        }),

      toggleMaximise: (id) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.state = win.state === "maximised" ? "normal" : "maximised"
        }),

      moveWindow: (id, rect) =>
        set((state) => {
          const win = state.windows.find((w) => w.id === id)
          if (win) win.rect = clampToViewport(rect, useViewportStore.getState())
        }),

      closeAll: () =>
        set((state) => {
          state.windows = []
          state.zSeq = 0
        }),
    })),
    {
      name: WORKSPACE_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      partialize: (state): PersistedWorkspace => ({
        windows: serialiseForPersist(state.windows),
        zSeq: state.zSeq,
      }),
      storage: createLegacyAwareStorage<PersistedWorkspace>({
        version: 1,
        legacy: {
          key: WORKSPACE_STORAGE_KEY,
          read: (raw) => readLegacyWindows(raw, isRestorable),
        },
      }),
    },
  ),
)
```

Note the legacy key and the persist key are the same string. That is intentional: the adapter tries `JSON.parse` first, and a legacy payload has no `state` field, so it falls through to the converter, which rewrites the slot as an envelope. Both branches are covered by Task 3's tests.

- [ ] **Step 4: Move `isRestorable` into the store**

Move the `isRect`/`isRestorable` functions out of the deleted `use-window-persistence.ts` and into `workspace.store.ts`, exported. Replace its `WINDOW_REGISTRY` membership check with `Object.hasOwn(WINDOW_META, kind)` in Task 7; for now keep it reading `WINDOW_REGISTRY`.

```ts
function isRect(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false
  const r = v as Record<string, unknown>
  // Number.isFinite, not typeof: JSON.parse turns an overflowing literal like
  // 1e999 into Infinity, which is typeof "number" and would survive into the
  // geometry maths.
  return (["x", "y", "w", "h"] as const).every((k) => Number.isFinite(r[k]))
}

/**
 * Validates a stored instance before it reaches the store.
 *
 * localStorage is user-writable and survives deploys, so a payload here can be
 * stale or hand-edited.
 */
export function isRestorable(v: unknown): v is WindowInstance {
  if (typeof v !== "object" || v === null) return false
  const w = v as Record<string, unknown>
  return (
    typeof w.id === "string" &&
    typeof w.kind === "string" &&
    typeof w.title === "string" &&
    // Finite, not merely numeric: an Infinity here would poison zSeq for the
    // whole session, since every later nextZ derives from it.
    Number.isFinite(w.zIndex) &&
    (w.state === "normal" || w.state === "minimised" || w.state === "maximised") &&
    w.modal === false &&
    isRect(w.rect) &&
    Object.hasOwn(WINDOW_REGISTRY, w.kind as string)
  )
}
```

- [ ] **Step 5: Delete the superseded persistence hook**

```bash
git rm components/windows/use-window-persistence.ts components/windows/use-window-persistence.test.ts
```

Remove its import and call from `client/app/core/core-shell.tsx`.

- [ ] **Step 6: Point the viewport sync at the new store**

In `client/components/windows/window-layer.tsx`, replace `const setViewport = useWorkspaceStore((st) => st.setViewport)` with `const setViewport = useViewportStore((st) => st.setViewport)` and update the import. (The rAF throttle lands in Task 20.)

- [ ] **Step 7: Run the tests**

Run: `pnpm exec vitest run stores/workspace.store.test.ts && pnpm test`
Expected: PASS. `use-window-persistence.test.ts` is gone; its coverage now lives in `legacy-storage.test.ts`, `persist-storage.test.ts` and the new persistence block.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm run typecheck
git add -A
git commit -m "feat(state): move workspace persistence onto zustand persist + immer"
```

---

## Task 7: Split the window registry — defect #1

`defaultRect`, `minSize` and `singleton` are declared in `lib/windows/registry.tsx` and read by nothing, so every window opens at the store's hard-coded 900×600 default and every window shares the 320×200 resize floor. The store cannot read the registry today because the registry imports React components.

**Files:**
- Create: `client/lib/windows/meta.ts`
- Modify: `client/lib/windows/registry.tsx` (components only)
- Modify: `client/lib/windows/types.ts`
- Modify: `client/stores/workspace.store.ts` (`openWindow` resolves meta; `isRestorable` checks `WINDOW_META`)
- Modify: `client/components/windows/window-frame.tsx` (forward `minSize`)
- Modify: `client/components/windows/window-layer.tsx`, `client/components/windows/dock.tsx` (read from the new maps)
- Modify call sites that hand-repeat metadata: `client/components/shell/use-auth-window.ts`, `client/components/domains/contacts-window.tsx`, `client/components/domains/files-window.tsx`
- Test: `client/stores/workspace.store.test.ts`

**Interfaces:**
- Produces:
  - `WINDOW_META: Record<WindowKind, WindowMeta>` where `WindowMeta = { kind, title, icon, singleton, modal, defaultRect?, minSize? }`
  - `WINDOW_COMPONENTS: Partial<Record<WindowKind, LazyExoticComponent<WindowBody>>>`
  - `openWindow(input: OpenWindowInput): string` where `OpenWindowInput = { kind: WindowKind; title?: string; props?: JsonObject; modal?: boolean; singletonKey?: string; rect?: Partial<Rect> }`
  - `WindowInstance` gains `minSize?: { w: number; h: number }` and `props?: JsonObject`

- [ ] **Step 1: Write the failing tests**

Append to `client/stores/workspace.store.test.ts`:

```ts
describe("openWindow resolves the registry descriptor", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1440, h: 900 })
  })

  it("uses the kind's declared defaultRect instead of the store default", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "confirm", singletonKey: "c:1" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect({ w: win.rect.w, h: win.rect.h }).toEqual({ w: 420, h: 220 })
  })

  it("falls back to the store default for a kind that declares no rect", () => {
    // `auth` is chromeless: WindowLayer centres it and never reads its rect, so
    // WINDOW_META deliberately gives it no defaultRect.
    const id = useWorkspaceStore.getState().openWindow({ kind: "auth" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect({ w: win.rect.w, h: win.rect.h }).toEqual({ w: 900, h: 600 })
  })

  it("marks a kind declared modal as modal without the caller saying so", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "auth" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.modal).toBe(true)
    expect(win.zIndex).toBeGreaterThanOrEqual(MODAL_Z_BASE)
  })

  it("carries the declared minSize onto the instance", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.minSize).toEqual({ w: 420, h: 320 })
  })

  it("takes the declared title when the caller gives none", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    expect(useWorkspaceStore.getState().windows.find((w) => w.id === id)!.title).toBe("Terminal")
  })

  it("lets an explicit override beat the descriptor", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "terminal", title: "Shell", rect: { w: 500 } })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.title).toBe("Shell")
    expect(win.rect.w).toBe(500)
  })

  it("opens a second instance of a non-singleton kind", () => {
    const a = useWorkspaceStore.getState().openWindow({ kind: "record-edit", singletonKey: "e:1" })
    const b = useWorkspaceStore.getState().openWindow({ kind: "record-edit", singletonKey: "e:2" })
    expect(a).not.toBe(b)
    expect(useWorkspaceStore.getState().windows).toHaveLength(2)
  })

  it("focuses rather than duplicating a singleton kind", () => {
    const a = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    const b = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    expect(a).toBe(b)
    expect(useWorkspaceStore.getState().windows).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run stores/workspace.store.test.ts`
Expected: FAIL — auth opens 900×600 and `modal` is false.

- [ ] **Step 3: Create the metadata map**

Create `client/lib/windows/meta.ts` holding the pure descriptor data for all nine currently-registered kinds. Values are copied verbatim from today's `registry.tsx`:

```ts
import {
  FileIcon, FilePlusIcon, FileTextIcon, LockIcon, MicIcon,
  PencilIcon, ShieldAlertIcon, TerminalIcon, UsersIcon,
} from "lucide-react"
import type { WindowKind, WindowMeta } from "./types"

/**
 * Descriptor data for every window kind, with no React component in sight.
 *
 * Split from the registry so the workspace store can resolve a kind's title,
 * modality, singleton-ness and geometry without importing lazy component
 * chunks into Ring 1. Before the split these fields were declared here and read
 * nowhere, so every window opened at the store's 900×600 fallback.
 */
export const WINDOW_META: Partial<Record<WindowKind, WindowMeta>> = {
  // No defaultRect: chrome "none" means WindowLayer centres this one and never
  // reads its rect. Do not reinstate a rect here.
  auth: { kind: "auth", title: "Access", icon: LockIcon, singleton: true, modal: true, chrome: "none" },
  terminal: { kind: "terminal", title: "Terminal", icon: TerminalIcon, singleton: true, modal: false, defaultRect: { w: 900, h: 600 }, minSize: { w: 420, h: 320 } },
  contacts: { kind: "contacts", title: "Contacts", icon: UsersIcon, singleton: true, modal: false, defaultRect: { w: 980, h: 620 }, minSize: { w: 520, h: 360 } },
  files: { kind: "files", title: "Files", icon: FileIcon, singleton: true, modal: false, defaultRect: { w: 980, h: 660 }, minSize: { w: 520, h: 400 } },
  "record-create": { kind: "record-create", title: "New record", icon: FilePlusIcon, singleton: false, modal: false, defaultRect: { w: 460, h: 600 } },
  "record-edit": { kind: "record-edit", title: "Edit record", icon: PencilIcon, singleton: false, modal: false, defaultRect: { w: 460, h: 600 } },
  "record-detail": { kind: "record-detail", title: "Record", icon: FileTextIcon, singleton: false, modal: false, defaultRect: { w: 460, h: 600 } },
  confirm: { kind: "confirm", title: "Confirm", icon: ShieldAlertIcon, singleton: false, modal: true, defaultRect: { w: 420, h: 220 } },
  voice: { kind: "voice", title: "Live", icon: MicIcon, singleton: true, modal: false, defaultRect: { w: 420, h: 480 } },
}
```

- [ ] **Step 4: Update the types**

In `client/lib/windows/types.ts`: add `WindowMeta`, add `minSize` and `JsonObject` props to `WindowInstance`, and reduce `WindowDescriptor` to the component map's value type.

```ts
import type { JsonObject } from "@/lib/state/json"

export interface WindowMeta {
  kind: WindowKind
  title: string
  icon: LucideIcon
  /** Focus-if-open instead of spawning a duplicate. */
  singleton: boolean
  /** true ⇒ scrim + focus trap, and drawn in the always-higher modal band. */
  modal: boolean
  /**
   * "none" ⇒ WindowLayer centres the body itself and draws no frame: no title
   * bar, no window controls, no resize grips. For a gate like the auth dialog,
   * where the body is already a Card and there is nothing legitimate to close.
   */
  chrome?: "frame" | "none"
  defaultRect?: Partial<Rect>
  minSize?: { w: number; h: number }
}
```

`chrome` already exists on `WindowDescriptor` in the current `types.ts` — move it onto
`WindowMeta` verbatim, comment included, and delete it from `WindowDescriptor`. `WindowLayer`
currently reads `descriptor.chrome`; it must read `WINDOW_META[win.kind]?.chrome` after this
task.

```ts

export interface WindowInstance {
  id: string
  kind: WindowKind
  title: string
  /** Narrowed to JsonObject in Task 18, once the last callback prop is gone. */
  props?: Record<string, unknown>
  rect: Rect
  minSize?: { w: number; h: number }
  zIndex: number
  state: WindowState
  modal: boolean
}
```

Do **not** narrow `props` to `JsonObject` in this task. `contacts-window.tsx` still
passes an `onDone` closure until Task 18, so narrowing here cannot typecheck. The
`JsonObject` import is not needed yet either.

- [ ] **Step 5: Reduce the registry to components**

Rewrite `client/lib/windows/registry.tsx` to export only `WINDOW_COMPONENTS`, keeping every existing `lazy(...)` entry and the `withMode` helper verbatim. Delete the metadata fields from each entry.

- [ ] **Step 6: Resolve the descriptor in `openWindow`**

```ts
openWindow: (input) => {
  const meta = WINDOW_META[input.kind]
  const key = input.singletonKey ?? (meta?.singleton === false ? nanoid() : input.kind)
  const existing = get().windows.find((w) => keyOf(w) === key)

  if (existing) {
    get().focusWindow(existing.id)
    if (get().windows.find((w) => w.id === existing.id)?.state === "minimised") {
      get().restoreWindow(existing.id)
    }
    return existing.id
  }

  const id = nanoid()
  const modal = input.modal ?? meta?.modal ?? false
  const viewport = useViewportStore.getState()
  const nextZ = get().zSeq + 1

  const base = clampToViewport(
    { ...DEFAULT_RECT, ...meta?.defaultRect, ...input.rect },
    viewport,
  )
  // An explicit x means the caller placed it; only auto-placed windows cascade.
  const rect = input.rect?.x != null ? base : cascade(get().windows.length, base, viewport)

  const instance: WindowInstance = {
    id,
    kind: input.kind,
    title: input.title ?? meta?.title ?? input.kind,
    props: { ...input.props, __key: key },
    rect,
    minSize: meta?.minSize,
    zIndex: modal ? MODAL_Z_BASE + nextZ : nextZ,
    state: "normal",
    modal,
  }

  set((state) => {
    state.windows.push(instance)
    state.zSeq = nextZ
  })
  return id
}
```

Also change `isRestorable`'s last clause to `Object.hasOwn(WINDOW_META, w.kind as string)`.

- [ ] **Step 7: Forward `minSize` into the drag handler**

In `client/components/windows/window-frame.tsx`, pass it through:

```ts
const { liveRect, isInteracting, dragProps, resizeProps } = useDragResize({
  rect: win.rect,
  minSize: win.minSize,
  disabled: isMobile || isMaximised,
  onCommit: onMove,
})
```

`useDragResize` already defaults `minSize` to `DEFAULT_MIN` when undefined — no change needed there.

- [ ] **Step 8: Update the two registry readers and three call sites**

- `window-layer.tsx`: `const Body = WINDOW_COMPONENTS[win.kind]` for the component, and
  `const meta = WINDOW_META[win.kind]` for `meta?.chrome === "none"`. The existing chromeless
  branch — the centred, frameless `inset-0` container for the auth gate — stays exactly as it
  is; only where it reads `chrome` from changes. Keep the `if (!Body) return null` guard so an
  unregistered kind still renders nothing.
- `dock.tsx`: `const Icon = WINDOW_META[win.kind]?.icon`.
- `use-auth-window.ts`: `openWindow({ kind: "auth" })` — drop `title` and `modal`.
- `contacts-window.tsx` / `files-window.tsx`: drop `modal: true` from the `confirm` calls; keep `title` (they compute singular/plural) and keep `singletonKey`.

- [ ] **Step 9: Run the tests**

Run: `pnpm test`
Expected: PASS, including the seven new descriptor tests.

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm run typecheck && pnpm run lint
git add -A
git commit -m "fix(windows): resolve declared descriptor metadata in openWindow

defaultRect, minSize and singleton were declared per kind and read by
nothing, so every window opened at the store's 900x600 fallback with a
320x200 resize floor - the auth gate included."
```

---

## Task 8: Upload store on immer

**Files:**
- Modify: `client/stores/upload.store.ts`
- Test: `client/stores/upload.store.test.ts` (create — there is none today)

**Interfaces:**
- Produces: `useUploadStore` — same actions (`add`, `update`, `remove`, `clearSettled`, `reset`), same `isSettled` and `selectActiveUploads` exports.

- [ ] **Step 1: Write the failing test**

Create `client/stores/upload.store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { isSettled, selectActiveUploads, useUploadStore } from "./upload.store"

const s = () => useUploadStore.getState()

const item = {
  localId: "a",
  filename: "notes.md",
  size: 12,
  mimeType: "text/markdown",
  phase: "queued" as const,
  percent: 0,
  ingestable: true,
}

describe("upload.store", () => {
  beforeEach(() => s().reset())

  it("adds an item", () => {
    s().add(item)
    expect(s().items).toHaveLength(1)
  })

  it("applies progress to the matching item only", () => {
    s().add(item)
    s().add({ ...item, localId: "b" })
    s().update("a", { phase: "uploading", percent: 40 })

    expect(s().items.find((i) => i.localId === "a")!.percent).toBe(40)
    expect(s().items.find((i) => i.localId === "b")!.percent).toBe(0)
  })

  it("never unsets a fileId once initiate has handed one over", () => {
    s().add(item)
    s().update("a", { phase: "uploading", percent: 10, fileId: "f1" })
    s().update("a", { phase: "processing", percent: 100 })
    expect(s().items[0].fileId).toBe("f1")
  })

  it("keeps a deduplicated flag across later frames", () => {
    s().add(item)
    s().update("a", { phase: "processing", percent: 100, deduplicated: true })
    s().update("a", { phase: "indexed", percent: 100 })
    expect(s().items[0].deduplicated).toBe(true)
  })

  it("clears only settled items", () => {
    s().add(item)
    s().add({ ...item, localId: "b", phase: "indexed" })
    s().add({ ...item, localId: "c", phase: "failed" })
    s().clearSettled()
    expect(s().items.map((i) => i.localId)).toEqual(["a"])
  })

  it("removes one item by id", () => {
    s().add(item)
    s().remove("a")
    expect(s().items).toHaveLength(0)
  })

  it("classifies terminal phases as settled", () => {
    expect(isSettled("indexed")).toBe(true)
    expect(isSettled("failed")).toBe(true)
    expect(isSettled("uploading")).toBe(false)
  })

  it("selects only live uploads", () => {
    s().add(item)
    s().add({ ...item, localId: "b", phase: "indexed" })
    expect(selectActiveUploads(s()).map((i) => i.localId)).toEqual(["a"])
  })
})
```

- [ ] **Step 2: Run to confirm it passes or fails**

Run: `pnpm exec vitest run stores/upload.store.test.ts`
Expected: PASS against the current implementation — this test is written first as a **behaviour lock** before the immer rewrite, so a regression in Step 3 is caught immediately.

- [ ] **Step 3: Rewrite the store with immer**

```ts
export const useUploadStore = create<UploadStoreState>()(
  immer((set) => ({
    items: [],

    add: (item) =>
      set((state) => {
        state.items.push(item)
      }),

    update: (localId, progress) =>
      set((state) => {
        const item = state.items.find((i) => i.localId === localId)
        if (!item) return
        item.phase = progress.phase
        item.percent = progress.percent
        // Never unset a fileId once initiate has handed one over: later
        // progress frames for the polling phases omit it.
        // `!== undefined`, not truthiness: this must match the old
        // `progress.fileId ?? i.fileId` exactly, and stay symmetric with the
        // `deduplicated` check below.
        if (progress.fileId !== undefined) item.fileId = progress.fileId
        item.error = progress.error
        if (progress.deduplicated !== undefined) item.deduplicated = progress.deduplicated
      }),

    remove: (localId) =>
      set((state) => {
        state.items = state.items.filter((i) => i.localId !== localId)
      }),

    clearSettled: () =>
      set((state) => {
        state.items = state.items.filter((i) => !isSettled(i.phase))
      }),

    reset: () =>
      set((state) => {
        state.items = []
      }),
  })),
)
```

- [ ] **Step 4: Run the test to verify it still passes**

Run: `pnpm exec vitest run stores/upload.store.test.ts && pnpm test`
Expected: PASS, all 8 upload tests plus the full suite.

- [ ] **Step 5: Commit**

```bash
git add stores/upload.store.ts stores/upload.store.test.ts
git commit -m "refactor(state): move upload store onto immer, with a behaviour-lock test"
```

---

## Task 9: Rename the auth store to session (mechanical)

**Files:**
- Rename: `client/stores/auth.store.ts` → `client/stores/session.store.ts`, `client/stores/auth.store.test.ts` → `client/stores/session.store.test.ts`
- Modify (import + identifier only): `client/lib/api/provider.tsx`, `client/components/auth/sign-in-pane.tsx`, `client/components/auth/register-pane.tsx`, `client/components/shell/shell-chrome.tsx`, `client/components/shell/use-auth-window.ts`, `client/components/shell/use-session-bootstrap.ts`, `client/components/terminal/use-agent-chat.ts`, `client/app/core/core-shell.tsx`, and the four test files referencing it

- [ ] **Step 1: Rename with git**

```bash
git mv stores/auth.store.ts stores/session.store.ts
git mv stores/auth.store.test.ts stores/session.store.test.ts
```

- [ ] **Step 2: Rename module path and hook**

```bash
grep -rl "stores/auth.store\|useAuthStore\|\./auth\.store" --include="*.ts" --include="*.tsx" . \
  | xargs sed -i '' \
    -e 's#stores/auth\.store#stores/session.store#g' \
    -e 's#\./auth\.store#./session.store#g' \
    -e 's#useAuthStore#useSessionStore#g'
```

- [ ] **Step 3: Verify and test**

Run: `grep -rn "useAuthStore\|stores/auth.store\|\./auth\.store" --include="*.ts" --include="*.tsx" .`

The bare-relative form matters: `git mv` does not rewrite import text, and `stores/auth.store`
alone does not match `from "./auth.store"` inside the renamed test file. Task 5 hit exactly this
— its grep reported clean while the suite was failing.
Expected: no output.

Run: `pnpm test && pnpm run typecheck`
Expected: all green. `REFRESH_STORAGE_KEY` is still `"cyb.refresh"` in this task.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(state): rename auth.store to session.store"
```

---

# Phase C — SWR wiring

## Task 10: Fetcher and invalidation hook

**Files:**
- Create: `client/lib/swr/fetcher.ts`
- Create: `client/lib/swr/use-invalidate.ts`
- Test: `client/lib/swr/fetcher.test.ts`

**Interfaces:**
- Consumes: `keys` (Task 1), `hasPrefix` (Task 1), `ApiClient` from `@/lib/api/client`.
- Produces:
  - `createFetcher(client: ApiClient): (key: readonly unknown[]) => Promise<unknown>`
  - `useInvalidate(): (prefix: readonly unknown[]) => Promise<unknown[]>`

- [ ] **Step 1: Write the failing test**

Create `client/lib/swr/fetcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import type { ApiClient } from "@/lib/api/client"
import { createFetcher } from "./fetcher"
import { keys } from "./keys"
import { initialQuery } from "@/components/data-table/query"

function stubClient() {
  const get = vi.fn().mockResolvedValue({ ok: true })
  return { client: { get } as unknown as ApiClient, get }
}

describe("createFetcher", () => {
  it("resolves the session key to /auth/me", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.session())
    expect(get).toHaveBeenCalledWith("/auth/me")
  })

  it("resolves the conversations key to its embedded url", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.conversations(2, 10))
    expect(get).toHaveBeenCalledWith("/agent/conversations?page=2&limit=10")
  })

  it("resolves a messages key to the conversation's messages route", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.messages("c9"))
    expect(get).toHaveBeenCalledWith("/agent/conversations/c9/messages")
  })

  it("resolves a list key to the url the key already carries", async () => {
    const { client, get } = stubClient()
    const key = keys.list("/contacts", initialQuery())
    await createFetcher(client)(key)
    expect(get).toHaveBeenCalledWith(key[2])
  })

  it("resolves a record key to endpoint/id", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.record("/contacts", "abc"))
    expect(get).toHaveBeenCalledWith("/contacts/abc")
  })

  it("rejects an unknown key rather than silently returning undefined", async () => {
    const { client } = stubClient()
    await expect(createFetcher(client)(["nope"] as never)).rejects.toThrow(/unknown swr key/i)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run lib/swr/fetcher.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement the fetcher**

Create `client/lib/swr/fetcher.ts`:

```ts
import type { ApiClient } from "@/lib/api/client"

/**
 * Turns a tuple cache key into a request.
 *
 * The switch is exhaustive and throws on anything it does not recognise. A
 * fetcher that quietly resolves `undefined` for a mistyped key produces an
 * empty list that looks exactly like a legitimately empty domain — the same
 * failure mode `buildListUrl`'s tests exist to prevent.
 */
export function createFetcher(client: ApiClient) {
  return async (key: readonly unknown[]): Promise<unknown> => {
    switch (key[0]) {
      case "session":
        return client.get("/auth/me")
      case "conversations":
        return client.get(key[1] as string)
      case "conversation":
        return client.get(`/agent/conversations/${key[1] as string}/messages`)
      case "list":
        return client.get(key[2] as string)
      case "record":
        return client.get(`${key[1] as string}/${key[2] as string}`)
      default:
        throw new Error(`Unknown SWR key: ${JSON.stringify(key)}`)
    }
  }
}
```

- [ ] **Step 4: Implement the invalidation hook**

Create `client/lib/swr/use-invalidate.ts`:

```ts
"use client"

import { useCallback } from "react"
import { useSWRConfig } from "swr"
import { hasPrefix } from "./match"

/**
 * Revalidates every cache entry under a key prefix.
 *
 * This replaces the `refreshToken: number` prop the tables used to thread down
 * and the `onDone` callbacks that travelled inside window props. A prefix
 * reaches every subscriber of that data, so deleting a row in one window
 * refreshes a second window showing the same list — which a callback held by
 * one opener never could.
 */
export function useInvalidate() {
  const { mutate } = useSWRConfig()
  // The explicit return type matters: ScopedMutator's filter overload infers
  // `Promise<any[]>`, and `any` would silently defeat type-checking in every
  // consumer that starts using the resolved value.
  return useCallback(
    (prefix: readonly unknown[]): Promise<unknown[]> => mutate((key) => hasPrefix(key, prefix)),
    [mutate],
  )
}
```

- [ ] **Step 4b: Test `useInvalidate` against a real cache**

This hook replaces the entire `refreshToken` / `onDone` protocol and Tasks 16–19 build on it.
Static reasoning is not enough: if its filter fails to match, it invalidates nothing, and
"nothing matched" looks exactly like "everything already fresh".

Create `client/lib/swr/use-invalidate.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import useSWR from "swr"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { initialQuery } from "@/components/data-table/query"
import { keys, scopes } from "./keys"
import { useInvalidate } from "./use-invalidate"

function wrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    )
  }
}

describe("useInvalidate", () => {
  it("revalidates every cached key under the prefix, and nothing outside it", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/contacts", q))
        useSWR(keys.list("/contacts", { ...q, page: 2 }))
        useSWR(keys.list("/files", q))
        return useInvalidate()
      },
      { wrapper: wrapper(fetcher) },
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    fetcher.mockClear()

    await result.current(scopes.allLists("/contacts"))

    // Both /contacts pages refetched; /files untouched.
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const refetched = fetcher.mock.calls.map((c) => (c[0] as unknown[])[1])
    expect(refetched).toEqual(["/contacts", "/contacts"])
  })

  it("matches nothing for a prefix no cached key carries", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
    const { result } = renderHook(
      () => {
        useSWR(keys.list("/contacts", initialQuery()))
        return useInvalidate()
      },
      { wrapper: wrapper(fetcher) },
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    fetcher.mockClear()

    await result.current(scopes.allLists("/nonexistent"))
    expect(fetcher).not.toHaveBeenCalled()
  })
})
```

The first test is the one that matters: it proves the filter reaches the *raw tuple key* SWR
stores, and that the prefix is genuinely scoping rather than matching everything or nothing.

- [ ] **Step 5: Run the test**

Run: `pnpm exec vitest run lib/swr/fetcher.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/swr/fetcher.ts lib/swr/fetcher.test.ts lib/swr/use-invalidate.ts
git commit -m "feat(state): add the swr fetcher and prefix invalidation hook"
```

---

## Task 11: StateProvider

**Files:**
- Create: `client/lib/swr/provider.tsx`
- Delete: `client/lib/api/provider.tsx` (its `useApi` moves into the new file unchanged)
- Modify: `client/app/layout.tsx`
- Modify (wrapper only): `client/components/auth/auth-window.test.tsx`, `client/components/terminal/terminal-window.test.tsx`, `client/components/data-table/data-table.test.tsx`
  (NOT `window-layer.test.tsx` — it never renders the provider, only mentions it in a comment.)
- Modify: every file importing `@/lib/api/provider`
- Test: `client/lib/swr/provider.test.tsx`

**Interfaces:**
- Produces:
  - `<StateProvider baseUrl? fetchImpl? onAuthFailure?>` — props match today's `ApiProvider` plus an optional failure hook.
  - `useApi(): { client: ApiClient; auth: AuthApi }` — unchanged signature, new module path `@/lib/swr/provider`.

- [ ] **Step 1: Write the failing test**

Create `client/lib/swr/provider.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import useSWR from "swr"
import { StateProvider, useApi } from "./provider"
import { keys } from "./keys"

function Probe() {
  const { data } = useSWR(keys.session())
  const { client, auth } = useApi()
  return (
    <div>
      <span data-testid="email">{(data as { email?: string } | undefined)?.email ?? "none"}</span>
      <span data-testid="wired">{client && auth ? "yes" : "no"}</span>
    </div>
  )
}

describe("StateProvider", () => {
  it("serves swr reads through the api client", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", kind: "user", email: "a@b.c" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    render(
      <StateProvider baseUrl="http://api.test" fetchImpl={fetchImpl}>
        <Probe />
      </StateProvider>,
    )

    expect(screen.getByTestId("wired")).toHaveTextContent("yes")
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("a@b.c"))
    expect(fetchImpl.mock.calls[0][0]).toBe("http://api.test/auth/me")
  })

  it("does not retry a failed read, so the refresh latch is never raced", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    )

    render(
      <StateProvider baseUrl="http://api.test" fetchImpl={fetchImpl}>
        <Probe />
      </StateProvider>,
    )

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 120))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run lib/swr/provider.test.tsx`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement the provider**

Create `client/lib/swr/provider.tsx`:

```tsx
"use client"

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react"
import { SWRConfig, useSWRConfig } from "swr"
import { createApiClient, type ApiClient } from "@/lib/api/client"
import { createAuthApi, type AuthApi } from "@/lib/api/endpoints/auth"
import { useSessionStore } from "@/stores/session.store"
import { createFetcher } from "./fetcher"

interface ApiContextValue {
  client: ApiClient
  auth: AuthApi
}

const ApiContext = createContext<ApiContextValue | null>(null)

type Mutator = ReturnType<typeof useSWRConfig>["mutate"]

/**
 * Hands the out-of-React auth-failure path a way to reach the cache.
 *
 * `onAuthFailure` fires from inside the API client, which lives above SWRConfig
 * and has no hook context. SWR's global `mutate` is not an option either: it
 * targets the default cache, and tests deliberately install their own provider.
 */
function CacheBridge({ onReady }: { onReady: (mutate: Mutator) => void }) {
  const { mutate } = useSWRConfig()
  onReady(mutate)
  return null
}

/**
 * The one place the API client, the SWR cache, and the stores are wired
 * together.
 *
 * `onAuthFailure` is a prop rather than a store reach-in, so `lib/api` no longer
 * imports a store and Ring 0 stops depending on Ring 1.
 */
export function StateProvider({
  children,
  baseUrl,
  fetchImpl,
  onAuthFailure,
}: {
  children: ReactNode
  baseUrl?: string
  fetchImpl?: typeof fetch
  onAuthFailure?: (mutate: Mutator | null) => void
}) {
  const mutateRef = useRef<Mutator | null>(null)
  const onReady = useCallback((mutate: Mutator) => {
    mutateRef.current = mutate
  }, [])

  const value = useMemo<ApiContextValue>(() => {
    // `onAuthFailure` below reads `mutateRef.current`. That closure is invoked by
    // the API client after an auth failure, never during render — but the rule
    // flags any `.current` access appearing in render-phase code and cannot see
    // the difference. The directive must sit immediately above this expression:
    // the rule reports at the `createApiClient(` call site, and
    // `eslint-disable-next-line` applies only to the literal next line, so any
    // comment between it and the code makes it inert.
    // eslint-disable-next-line react-hooks/refs
    const client = createApiClient({
      baseUrl: baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
      // Read through getState() rather than a subscription: the client must see
      // the current token at call time, and must not re-create itself whenever
      // the token rotates.
      getAccessToken: () => useSessionStore.getState().accessToken,
      // The `?? readPersistedRefresh()` fallback is load-bearing until Task 14's
      // hydration gate lands: `persist` uses skipHydration, so the in-memory
      // refreshToken is null until rehydrate(), and a 401 before then would
      // fail to refresh despite a valid token sitting in localStorage.
      // REMOVE THIS at Task 13, together with readPersistedRefresh itself, and
      // only once a test proves hydration precedes every request.
      getRefreshToken: () =>
        useSessionStore.getState().refreshToken ?? useSessionStore.getState().readPersistedRefresh(),
      onTokens: (pair) => useSessionStore.getState().setTokens(pair),
      // eslint-disable-next-line react-hooks/refs -- this closure is invoked by
      // the API client after an auth failure, never during render. The rule
      // cannot see that and flags any `.current` access in render-phase code.
      onAuthFailure: () => onAuthFailure?.(mutateRef.current),
      fetchImpl,
    })
    return { client, auth: createAuthApi(client) }
  }, [baseUrl, fetchImpl, onAuthFailure])

  return (
    <ApiContext.Provider value={value}>
      <SWRConfig
        value={{
          fetcher: createFetcher(value.client),
          revalidateOnFocus: false,
          // client.ts already owns the only retry that matters (401 → refresh →
          // one retry). Retrying on top of it multiplies requests against a
          // backend that treats two concurrent refreshes as token theft.
          shouldRetryOnError: false,
          dedupingInterval: 2000,
          keepPreviousData: true,
        }}
      >
        <CacheBridge onReady={onReady} />
        {children}
      </SWRConfig>
    </ApiContext.Provider>
  )
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error("useApi must be used inside <StateProvider>")
  return ctx
}
```

- [ ] **Step 4: Delete the old provider and repoint every import**

```bash
git rm lib/api/provider.tsx
grep -rl "@/lib/api/provider" --include="*.ts" --include="*.tsx" . \
  | xargs sed -i '' -e 's#@/lib/api/provider#@/lib/swr/provider#g' -e 's#ApiProvider#StateProvider#g'
```

- [ ] **Step 5: Update the root layout**

In `client/app/layout.tsx`, replace `<ApiProvider>` with `<StateProvider>`. The import was rewritten in Step 4.

- [ ] **Step 6: Give each provider-wrapping test an isolated cache**

In each of the four tests that render `<StateProvider>`, wrap the tree so no cache leaks between cases:

```tsx
import { SWRConfig } from "swr"

function wrap(ui: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="http://api.test" fetchImpl={fetchImpl}>
        {ui}
      </StateProvider>
    </SWRConfig>
  )
}
```

Assertions in those files are unchanged.

- [ ] **Step 7: Run everything**

Run: `pnpm test && pnpm run typecheck && pnpm run lint`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(state): replace ApiProvider with StateProvider (api client + swr config)"
```

---

## Task 12: `resetClientState` — defect #3

`useConversationStore.reset()` and `useUploadStore.reset()` exist and are called only from tests, so signing out leaves the previous user's rail, history and uploads resident in memory.

**Files:**
- Create: `client/lib/state/reset.ts`
- Modify: `client/app/layout.tsx` (pass `onAuthFailure`)
- Modify: `client/components/shell/shell-chrome.tsx` (sign-out path)
- Test: `client/lib/state/reset.test.ts`

**Interfaces:**
- Consumes: all five stores, plus a `Mutator` from Task 11.
- Produces: `resetClientState(mutate: Mutator | null): void`

- [ ] **Step 1: Write the failing test**

Create `client/lib/state/reset.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useUploadStore } from "@/stores/upload.store"
import { useSceneStore } from "@/stores/scene.store"
import { resetClientState } from "./reset"

describe("resetClientState", () => {
  it("clears every client store and evicts the whole swr cache", () => {
    useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 60 })
    useWorkspaceStore.getState().openWindow({ kind: "contacts" })
    useUploadStore.getState().add({
      localId: "u", filename: "f", size: 1, mimeType: "text/plain",
      phase: "uploading", percent: 10, ingestable: true,
    })
    useSceneStore.getState().togglePanel()

    const mutate = vi.fn()
    resetClientState(mutate)

    expect(useSessionStore.getState().accessToken).toBeNull()
    expect(useSessionStore.getState().refreshToken).toBeNull()
    expect(useWorkspaceStore.getState().windows).toHaveLength(0)
    expect(useUploadStore.getState().items).toHaveLength(0)
    expect(useSceneStore.getState().panelOpen).toBe(true)

    expect(mutate).toHaveBeenCalledTimes(1)
    const [matcher, data, opts] = mutate.mock.calls[0]
    expect(matcher(["anything"])).toBe(true)
    expect(data).toBeUndefined()
    expect(opts).toEqual({ revalidate: false })
  })

  it("still clears the stores when no cache handle is available yet", () => {
    useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 60 })
    resetClientState(null)
    expect(useSessionStore.getState().accessToken).toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run lib/state/reset.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement it**

Create `client/lib/state/reset.ts`:

```ts
import type { useSWRConfig } from "swr"
import { useSceneStore } from "@/stores/scene.store"
import { useSessionStore } from "@/stores/session.store"
import { useUploadStore } from "@/stores/upload.store"
import { useWorkspaceStore } from "@/stores/workspace.store"

type Mutator = ReturnType<typeof useSWRConfig>["mutate"]

/**
 * The single choke point for "this session is over".
 *
 * Every client store *and* the server cache are cleared together. Before this
 * existed, sign-out cleared tokens and closed windows while the conversation
 * rail, message history and in-flight uploads stayed resident — so signing in as
 * a different user on the same tab surfaced the previous user's data until the
 * first refetch overwrote it.
 *
 * `mutate` is nullable because the API client can fail auth before the cache
 * bridge has mounted; clearing the stores is still correct in that window.
 */
export function resetClientState(mutate: Mutator | null): void {
  useSessionStore.getState().clear()
  useWorkspaceStore.getState().closeAll()
  useUploadStore.getState().reset()
  useSceneStore.getState().reset()
  void mutate?.(() => true, undefined, { revalidate: false })
}
```

The turn store joins this list in Task 15, when it exists.

- [ ] **Step 4: Wire it into the layout**

In `client/app/layout.tsx`, the provider needs a client-side callback, so extract a small client component:

```tsx
// client/app/providers.tsx
"use client"

import { useCallback, type ReactNode } from "react"
import { StateProvider } from "@/lib/swr/provider"
import { resetClientState } from "@/lib/state/reset"

export function Providers({ children }: { children: ReactNode }) {
  const onAuthFailure = useCallback(
    (mutate: Parameters<typeof resetClientState>[0]) => resetClientState(mutate),
    [],
  )
  return <StateProvider onAuthFailure={onAuthFailure}>{children}</StateProvider>
}
```

Use `<Providers>` in `layout.tsx` in place of `<StateProvider>`.

- [ ] **Step 5: Wire it into sign-out**

In `client/components/shell/shell-chrome.tsx`, replace the body of `signOut`:

```tsx
const { mutate } = useSWRConfig()

async function signOut() {
  const refresh = useSessionStore.getState().refreshToken
  if (refresh) await auth.logout(refresh).catch(() => undefined)
  // No explicit reopen: useAuthGate brings the gate back as soon as the
  // cleared store says we are signed out.
  resetClientState(mutate)
}
```

- [ ] **Step 6: Run and commit**

Run: `pnpm test && pnpm run typecheck`

```bash
git add -A
git commit -m "fix(state): clear every client store and the swr cache on sign-out

Conversation, upload and scene state previously survived sign-out into the
next user's session on the same tab."
```

---

# Phase D — Session on SWR

## Task 13: `useSession` and the shrunken session store

> **Dispatched together with Task 14.** Removing `principal`/`selectIsAuthenticated` from the
> store and rewriting the gate that reads them are one compile unit — `use-auth-window.ts`
> imports `selectIsAuthenticated` until Task 14 deletes it. Run both tasks' steps, then
> typecheck once at the end of Task 14.

**Files:**
- Modify: `client/stores/session.store.ts` (drop `principal`, `status`, `error`, `setPrincipal`, `setStatus`, `setError`, `readPersistedRefresh`; add `refreshing`; add persist + immer)
- Modify: `client/stores/session.store.test.ts`
- Create: `client/features/session/use-session.ts`
- Create: `client/features/session/use-sign-in.ts`
- Modify: `client/components/auth/sign-in-pane.tsx`, `client/components/auth/register-pane.tsx`, `client/components/shell/shell-chrome.tsx`
- Test: `client/features/session/use-session.test.tsx`

**Interfaces:**
- Consumes: `keys.session()` (Task 1), `createLegacyAwareStorage` (Task 3), `readLegacyRefresh` (Task 2).
- Produces:
  - `useSessionStore` — `{ accessToken, refreshToken, refreshing, setTokens(pair), setRefreshing(v), clear() }`
  - `useSession(): { principal: UserProfile | null; authed: boolean; settling: boolean; error: unknown }`
  - `useSignIn(): { signIn(email, password): Promise<void>; register(input): Promise<void>; pending: boolean; error: string | null }`

- [ ] **Step 1: Write the failing test**

Create `client/features/session/use-session.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useSessionStore } from "@/stores/session.store"
import { keys } from "@/lib/swr/keys"
import { useSession } from "./use-session"

const PRINCIPAL = { id: "u1", kind: "user" as const, email: "a@b.c" }

function wrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SWRConfig value={{ provider: () => new Map(), fetcher, shouldRetryOnError: false, dedupingInterval: 0 }}>{children}</SWRConfig>
  }
}

describe("useSession", () => {
  beforeEach(() => useSessionStore.getState().clear())

  it("is signed out and not settling with no tokens at all", () => {
    const { result } = renderHook(() => useSession(), { wrapper: wrapper(vi.fn()) })
    expect(result.current.authed).toBe(false)
    expect(result.current.settling).toBe(false)
  })

  it("settles while a persisted refresh token has not been exchanged yet", () => {
    useSessionStore.setState({ refreshToken: "r" })
    const { result } = renderHook(() => useSession(), { wrapper: wrapper(vi.fn()) })
    expect(result.current.settling).toBe(true)
    expect(result.current.authed).toBe(false)
  })

  it("settles while the principal is loading", async () => {
    useSessionStore.setState({ accessToken: "a", refreshToken: "r" })
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}))
    const { result } = renderHook(() => useSession(), { wrapper: wrapper(fetcher) })
    await waitFor(() => expect(result.current.settling).toBe(true))
    expect(result.current.authed).toBe(false)
  })

  it("is authed once both a token and a principal are present", async () => {
    useSessionStore.setState({ accessToken: "a", refreshToken: "r" })
    const fetcher = vi.fn().mockResolvedValue(PRINCIPAL)
    const { result } = renderHook(() => useSession(), { wrapper: wrapper(fetcher) })

    await waitFor(() => expect(result.current.authed).toBe(true))
    expect(result.current.principal).toEqual(PRINCIPAL)
    expect(result.current.settling).toBe(false)
    expect(fetcher).toHaveBeenCalledWith(keys.session())
  })

  it("does not fetch the principal without an access token", () => {
    const fetcher = vi.fn()
    renderHook(() => useSession(), { wrapper: wrapper(fetcher) })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it("settles while an explicit refresh is in flight", () => {
    useSessionStore.setState({ refreshing: true })
    const { result } = renderHook(() => useSession(), { wrapper: wrapper(vi.fn()) })
    expect(result.current.settling).toBe(true)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run features/session/use-session.test.tsx`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Rewrite the session store**

Replace `client/stores/session.store.ts` entirely:

```ts
import { create } from "zustand"
import { persist } from "zustand/middleware"
import { immer } from "zustand/middleware/immer"
import { readLegacyRefresh } from "@/lib/state/legacy-storage"
import { createLegacyAwareStorage } from "@/lib/state/persist-storage"
import type { TokenPair } from "@/lib/api/types"

export const SESSION_STORAGE_KEY = "cyb.refresh"

interface PersistedSession {
  refreshToken: string | null
}

interface SessionState extends PersistedSession {
  accessToken: string | null
  /** True only while the boot-time refresh exchange is in flight. SWR cannot
   *  know about it: the exchange happens below the cache. */
  refreshing: boolean
  setTokens: (pair: TokenPair) => void
  setRefreshing: (value: boolean) => void
  clear: () => void
}

/**
 * Tokens, and nothing else.
 *
 * The principal moved to SWR (`useSession`): it is the server's truth, it has a
 * cache key, and keeping a copy here meant a hand-rolled status machine that
 * mirrored what SWR already tracks.
 *
 * Only the refresh token is persisted. The API sets `credentials: false` in
 * CORS, so there is no cookie transport and the refresh token has to survive a
 * reload somehow; the access token is the credential an XSS would actually want,
 * so it stays in memory and never touches storage.
 */
export const useSessionStore = create<SessionState>()(
  persist(
    immer((set) => ({
      accessToken: null,
      refreshToken: null,
      refreshing: false,

      setTokens: (pair) =>
        set((state) => {
          state.accessToken = pair.accessToken
          state.refreshToken = pair.refreshToken
        }),

      setRefreshing: (value) =>
        set((state) => {
          state.refreshing = value
        }),

      clear: () =>
        set((state) => {
          state.accessToken = null
          state.refreshToken = null
          state.refreshing = false
        }),
    })),
    {
      name: SESSION_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      partialize: (state): PersistedSession => ({ refreshToken: state.refreshToken }),
      storage: createLegacyAwareStorage<PersistedSession>({
        version: 1,
        legacy: { key: SESSION_STORAGE_KEY, read: readLegacyRefresh },
      }),
    },
  ),
)
```

- [ ] **Step 4: Implement `useSession`**

Create `client/features/session/use-session.ts`:

```ts
"use client"

import useSWR from "swr"
import { keys } from "@/lib/swr/keys"
import type { UserProfile } from "@/lib/api/types"
import { useSessionStore } from "@/stores/session.store"

export interface Session {
  principal: UserProfile | null
  /** A token *and* a principal. Either alone is a half-session. */
  authed: boolean
  /** The session is still resolving — never show the gate while this is true. */
  settling: boolean
  error: unknown
}

/**
 * The session, composed from the token store and the server's principal.
 *
 * `settling` is what the auth gate keys on, and it covers all three ways a
 * session can be mid-resolution: a persisted refresh token not yet exchanged, an
 * exchange in flight, and a principal being fetched. Deriving it from SWR state
 * — which is correct *within* the render — is what removed the previous
 * implementation's `getState()` escape hatch, where a render-time capture of a
 * hand-rolled status was stale in the same commit and flashed the login dialog
 * at a returning user.
 */
export function useSession(): Session {
  const accessToken = useSessionStore((s) => s.accessToken)
  const refreshToken = useSessionStore((s) => s.refreshToken)
  const refreshing = useSessionStore((s) => s.refreshing)

  const { data, isLoading, error } = useSWR<UserProfile>(accessToken ? keys.session() : null)

  return {
    principal: data ?? null,
    authed: Boolean(accessToken && data),
    settling: refreshing || (Boolean(refreshToken) && !accessToken) || (Boolean(accessToken) && isLoading),
    error,
  }
}
```

- [ ] **Step 5: Implement `useSignIn`**

Create `client/features/session/use-sign-in.ts`:

```ts
"use client"

import { useCallback, useState } from "react"
import { useSWRConfig } from "swr"
import { ApiError } from "@/lib/api/errors"
import { keys } from "@/lib/swr/keys"
import { useApi } from "@/lib/swr/provider"
import type { TokenPair } from "@/lib/api/types"
import { useSessionStore } from "@/stores/session.store"

/**
 * The two ways in. Both end by seeding the principal cache from the login
 * response's own follow-up call, so `authed` flips in the same tick rather than
 * after a second render.
 */
export function useSignIn() {
  const { client, auth } = useApi()
  const { mutate } = useSWRConfig()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (getPair: () => Promise<TokenPair>, failure: string) => {
      setPending(true)
      setError(null)
      try {
        useSessionStore.getState().setTokens(await getPair())
        // Populate the session key directly: without it the gate would wait a
        // full revalidation round-trip before closing.
        await mutate(keys.session(), await auth.me(), { revalidate: false })
      } catch (err) {
        // Clear rather than leave half a session behind: login may have
        // succeeded and /auth/me failed, which would otherwise leave tokens
        // with no principal.
        useSessionStore.getState().clear()
        await mutate(keys.session(), undefined, { revalidate: false })
        setError(err instanceof ApiError ? err.message : failure)
      } finally {
        setPending(false)
      }
    },
    [auth, mutate],
  )

  const signIn = useCallback(
    (email: string, password: string) =>
      run(() => auth.login({ email, password }), "Could not sign in"),
    [auth, run],
  )

  const register = useCallback(
    (input: { email: string; password: string; displayName?: string }) =>
      run(
        () =>
          client.post<TokenPair>("/auth/register", {
            email: input.email,
            password: input.password,
            displayName: input.displayName || undefined,
          }),
        "Could not create the account",
      ),
    [client, run],
  )

  return { signIn, register, pending, error }
}
```

- [ ] **Step 6: Rewire the three consumers**

- `sign-in-pane.tsx`: drop the local `pending`/`error` state and the store calls; use `const { signIn, pending, error } = useSignIn()` and `await signIn(email, password)`.
- `register-pane.tsx`: same, with `register({ email, password, displayName })`.
- `shell-chrome.tsx`: replace `useSessionStore((s) => s.principal)` and `useSessionStore(selectIsAuthenticated)` with `const { principal, authed } = useSession()`.

- [ ] **Step 7: Update the session store tests**

Rewrite `client/stores/session.store.test.ts` for the new surface: `setTokens` sets both tokens; `clear` nulls both and `refreshing`; only `refreshToken` reaches storage; `accessToken` never appears in `localStorage`. Delete the `setPrincipal`/`setStatus`/`setError` cases.

- [ ] **Step 8: Run**

Run: `pnpm exec vitest run features/session stores/session.store.test.ts && pnpm test`
Expected: `use-auth-window.test.tsx` and `auth-window.test.tsx` may now fail — they are rewritten in Task 14. If so, note it and continue; every other test must pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(session): move the principal to swr and shrink the session store to tokens"
```

---

## Task 14: Hydration, bootstrap, and the auth gate

**Files:**
- Create: `client/features/state-hydration.ts`
- Create: `client/features/session/use-session-bootstrap.ts` (replaces `components/shell/use-session-bootstrap.ts`)
- Create: `client/features/session/use-auth-gate.ts` (replaces `components/shell/use-auth-window.ts`)
- Delete: `client/components/shell/use-session-bootstrap.ts`, `client/components/shell/use-auth-window.ts`, `client/components/shell/use-auth-window.test.tsx`
- Modify: `client/app/core/core-shell.tsx`
- Test: `client/features/session/use-auth-gate.test.tsx`

**Interfaces:**
- Consumes: `useSession` (Task 13), `useWorkspaceStore` (Task 6/7).
- Produces:
  - `useStateHydration(): boolean`
  - `useSessionBootstrap(hydrated: boolean): void`
  - `useAuthGate(hydrated: boolean): void`

- [ ] **Step 1: Write the failing test**

Create `client/features/session/use-auth-gate.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useAuthGate } from "./use-auth-gate"

const PRINCIPAL = { id: "u1", kind: "user" as const, email: "a@b.c" }
const gate = () => useWorkspaceStore.getState().windows.find((w) => w.kind === "auth")

function wrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SWRConfig value={{ provider: () => new Map(), fetcher, shouldRetryOnError: false, dedupingInterval: 0 }}>{children}</SWRConfig>
  }
}

describe("useAuthGate", () => {
  beforeEach(() => {
    useSessionStore.getState().clear()
    useWorkspaceStore.getState().closeAll()
  })

  it("opens the gate once hydration settles with no session", async () => {
    renderHook(() => useAuthGate(true), { wrapper: wrapper(vi.fn()) })
    await waitFor(() => expect(gate()).toBeDefined())
    expect(gate()!.modal).toBe(true)
  })

  it("opens nothing before hydration completes", () => {
    renderHook(() => useAuthGate(false), { wrapper: wrapper(vi.fn()) })
    expect(gate()).toBeUndefined()
  })

  it("does not flash the gate at a returning user mid-refresh", () => {
    useSessionStore.setState({ refreshToken: "r", refreshing: true })
    renderHook(() => useAuthGate(true), { wrapper: wrapper(vi.fn()) })
    expect(gate()).toBeUndefined()
  })

  it("does not flash the gate while the principal is still loading", async () => {
    useSessionStore.setState({ accessToken: "a", refreshToken: "r" })
    const { rerender } = renderHook(() => useAuthGate(true), {
      wrapper: wrapper(() => new Promise(() => {})),
    })
    rerender()
    expect(gate()).toBeUndefined()
  })

  it("closes the gate as soon as a session resolves", async () => {
    renderHook(() => useAuthGate(true), { wrapper: wrapper(async () => PRINCIPAL) })
    await waitFor(() => expect(gate()).toBeDefined())

    useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 60 })
    await waitFor(() => expect(gate()).toBeUndefined())
  })

  it("opens exactly one gate no matter how often it reconciles", async () => {
    const { rerender } = renderHook(() => useAuthGate(true), { wrapper: wrapper(vi.fn()) })
    await waitFor(() => expect(gate()).toBeDefined())
    rerender()
    rerender()
    expect(useWorkspaceStore.getState().windows.filter((w) => w.kind === "auth")).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run features/session/use-auth-gate.test.tsx`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement hydration**

Create `client/features/state-hydration.ts`:

```ts
"use client"

import { useEffect, useState } from "react"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"

/**
 * Rehydrates the persisted stores, and reports when they are ready.
 *
 * Both stores set `skipHydration`, so nothing is read from localStorage during
 * render — which is what keeps the server-rendered HTML and the first client
 * render identical. Everything that depends on persisted state waits on the
 * boolean this returns, which turns the old "order is load-bearing" comment in
 * CoreShell into a dependency a test can assert.
 */
export function useStateHydration(): boolean {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      useSessionStore.persist.rehydrate(),
      useWorkspaceStore.persist.rehydrate(),
    ]).then(() => {
      if (!cancelled) setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return hydrated
}
```

**This ordering is a correctness constraint, not a preference.** `persist` writes after every
`setState` with no hydration guard, so ANY workspace mutation before `rehydrate()` completes
overwrites the persisted slot. `useAuthGate` opens the auth window on mount for a signed-out
user — exactly such a mutation. `useStateHydration()` must therefore run, and resolve, before
`useAuthGate`. The storage adapter also refuses to clobber an un-upgraded legacy payload as a
second line of defence, but do not rely on that alone: add a test asserting that mounting the
shell signed-out does not destroy a legacy `cyb.windows` payload.

- [ ] **Step 4: Implement the bootstrap**

Create `client/features/session/use-session-bootstrap.ts`:

```ts
"use client"

import { useEffect } from "react"
import { useApi } from "@/lib/swr/provider"
import { useSessionStore } from "@/stores/session.store"

/**
 * Exchanges a surviving refresh token for a session on load.
 *
 * Only the exchange lives here. Fetching the principal is SWR's job — the
 * `session` key turns non-null the moment an access token lands, so there is no
 * second step to sequence and no way for the two to disagree.
 */
export function useSessionBootstrap(hydrated: boolean): void {
  const { auth } = useApi()

  useEffect(() => {
    if (!hydrated) return

    const store = useSessionStore.getState()
    // Already signed in (e.g. React strict-mode double-invoke).
    if (store.accessToken) return
    // Nothing to resume. `settling` is false, which is what opens the gate.
    if (!store.refreshToken) return

    let cancelled = false
    store.setRefreshing(true)

    void auth
      .refresh(store.refreshToken)
      .then((pair) => {
        if (!cancelled) useSessionStore.getState().setTokens(pair)
      })
      .catch(() => {
        if (!cancelled) useSessionStore.getState().clear()
      })
      .finally(() => {
        if (!cancelled) useSessionStore.getState().setRefreshing(false)
      })

    return () => {
      cancelled = true
    }
  }, [hydrated, auth])
}
```

- [ ] **Step 5: Implement the gate**

Create `client/features/session/use-auth-gate.ts`:

```ts
"use client"

import { useEffect } from "react"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useSession } from "./use-session"

/**
 * Returns an id rather than the instance, so the subscription compares by
 * identity without needing `useShallow` — the trap documented in
 * window-layer.tsx:16-18, where a selector returning a fresh object each call
 * re-renders forever under zustand v5.
 */
const selectGateId = (st: ReturnType<typeof useWorkspaceStore.getState>): string | null =>
  st.windows.find((w) => w.kind === "auth")?.id ?? null

/**
 * Makes the auth window derived state rather than something call sites remember
 * to open and close.
 *
 * It used to be purely imperative: the bootstrap and sign-out opened it, and
 * nothing closed it, so a successful login left the modal — and its
 * click-swallowing scrim — sitting over the app until a reload.
 *
 * Reconciling in one place fixes login, sign-out and mid-session expiry alike.
 */
export function useAuthGate(hydrated: boolean): void {
  const { authed, settling } = useSession()
  const gateId = useWorkspaceStore(selectGateId)

  useEffect(() => {
    if (!hydrated || settling) return

    const workspace = useWorkspaceStore.getState()
    if (authed) {
      if (gateId) workspace.closeWindow(gateId)
      return
    }
    if (!gateId) workspace.openWindow({ kind: "auth" })
  }, [hydrated, settling, authed, gateId])
}
```

- [ ] **Step 6: Rewire CoreShell**

```tsx
export function CoreShell() {
  // Persisted state first: the gate must decide against a restored workspace,
  // and the bootstrap must see a rehydrated refresh token.
  const hydrated = useStateHydration()
  useSessionBootstrap(hydrated)
  useAuthGate(hydrated)

  const { authed } = useSession()
  const { panelOpen, scannerVisible, resetToken } = useSceneControls()
  /* ...markup unchanged, minus the five props ShellChrome no longer needs... */
}
```

`useSceneControls` arrives in Task 20; until then keep the existing `useState` trio and pass the props as they are.

- [ ] **Step 7: Delete the superseded hooks**

```bash
git rm components/shell/use-session-bootstrap.ts
# use-auth-window.{ts,test.tsx} are UNTRACKED (the repo owner's uncommitted work).
# `git rm` fails on an untracked path — remove them from disk only.
rm -f components/shell/use-auth-window.ts components/shell/use-auth-window.test.tsx
```

- [ ] **Step 8: Update `auth-window.test.tsx`**

Point it at `<StateProvider>` (already done in Task 11) and replace any `useAuthStore` seeding with `useSessionStore.setState({ ... })`.

- [ ] **Step 9: Run and commit**

Run: `pnpm test && pnpm run typecheck && pnpm run lint`

```bash
git add -A
git commit -m "feat(session): derive the auth gate from swr state behind explicit hydration"
```

---

# Phase E — Features

## Task 15: Turn store and the agent read hooks

> **Dispatched together with Task 16.** Stripping the server-data actions from the store
> breaks `use-agent-chat.ts` and `terminal-window.tsx`, which Task 16 rewrites. Run both
> tasks' steps, then typecheck once at the end of Task 16.

**Files:**
- Rename: `client/stores/conversation.store.ts` → `client/stores/turn.store.ts` (and its test)
- Modify: `client/stores/turn.store.ts` (remove all server data)
- Create: `client/features/agent/use-conversations.ts`, `client/features/agent/use-messages.ts`
- Modify: `client/lib/state/reset.ts` (add the turn store)
- Test: `client/stores/turn.store.test.ts`, `client/features/agent/use-messages.test.tsx`

**Interfaces:**
- Consumes: `keys.conversations()`, `keys.messages(id)`, `reduceTurn`/`initialTurn`/`markCancelled`/`markInterrupted` from `@/lib/agent/reducer` (unchanged).
- Produces:
  - `useTurnStore` — `{ activeId, turn, optimistic, selectConversation(id), appendOptimistic(text), beginTurn(), applyEvent(e), cancelTurn(), interruptTurn(reason?), clearTurn(), settle(), reset() }`
  - `useConversations(): { conversations: PublicConversation[]; isLoading: boolean; error: unknown }`
  - `useMessages(): { messages: ChatMessageDto[]; isLoading: boolean; error: unknown }`
  - `IN_FLIGHT_ID`, `selectIsStreaming`, `selectPendingApproval` keep their names.

- [ ] **Step 1: Rename the store**

```bash
git mv stores/conversation.store.ts stores/turn.store.ts
git mv stores/conversation.store.test.ts stores/turn.store.test.ts
grep -rl "stores/conversation.store\|useConversationStore\|\./conversation\.store" --include="*.ts" --include="*.tsx" . \
  | xargs sed -i '' \
    -e 's#stores/conversation\.store#stores/turn.store#g' \
    -e 's#\./conversation\.store#./turn.store#g' \
    -e 's#useConversationStore#useTurnStore#g'

# Verify nothing was missed — the bare-relative form is easy to leave behind:
#   grep -rn "useConversationStore\|conversation\.store" --include="*.ts" --include="*.tsx" .
# must return nothing before you commit.
```

- [ ] **Step 2: Write the failing tests**

Rewrite `client/stores/turn.store.test.ts` to cover only client state:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { useTurnStore } from "./turn.store"

const s = () => useTurnStore.getState()

describe("turn.store", () => {
  beforeEach(() => s().reset())

  it("selecting a conversation drops the previous turn and optimistic rows", () => {
    s().selectConversation("c1")
    s().appendOptimistic("hi")
    s().beginTurn()
    s().selectConversation("c2")

    expect(s().activeId).toBe("c2")
    expect(s().optimistic).toHaveLength(0)
    expect(s().turn).toBeNull()
  })

  it("appends an optimistic user message with a non-colliding local id", () => {
    s().appendOptimistic("hello")
    expect(s().optimistic[0].role).toBe("user")
    expect(s().optimistic[0].id).toMatch(/^local-/)
    expect(s().optimistic[0].parts).toEqual([{ type: "text", text: "hello" }])
  })

  it("learns the conversation id from the start frame", () => {
    s().beginTurn()
    s().applyEvent({ type: "start", conversationId: "c9", runId: "r1" })
    expect(s().activeId).toBe("c9")
    expect(s().turn?.status).toBe("streaming")
  })

  it("ignores events with no open turn", () => {
    s().applyEvent({ type: "text-delta", delta: "x" })
    expect(s().turn).toBeNull()
  })

  it("marks a turn cancelled", () => {
    s().beginTurn()
    s().cancelTurn()
    expect(s().turn?.status).toBe("cancelled")
  })

  it("settle clears the turn and the optimistic rows together", () => {
    s().appendOptimistic("hi")
    s().beginTurn()
    s().settle()
    expect(s().turn).toBeNull()
    expect(s().optimistic).toHaveLength(0)
  })

  it("reset returns to a pristine store", () => {
    s().selectConversation("c1")
    s().appendOptimistic("hi")
    s().reset()
    expect({ activeId: s().activeId, optimistic: s().optimistic, turn: s().turn }).toEqual({
      activeId: null, optimistic: [], turn: null,
    })
  })
})
```

Create `client/features/agent/use-messages.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useTurnStore } from "@/stores/turn.store"
import { IN_FLIGHT_ID, useMessages } from "./use-messages"

const STORED = [{ id: "m1", role: "user" as const, createdAt: "t", parts: [{ type: "text" as const, text: "old" }] }]

function wrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SWRConfig value={{ provider: () => new Map(), fetcher, shouldRetryOnError: false, dedupingInterval: 0 }}>{children}</SWRConfig>
  }
}

describe("useMessages", () => {
  beforeEach(() => useTurnStore.getState().reset())

  it("fetches nothing for an unsent new chat", () => {
    const fetcher = vi.fn()
    const { result } = renderHook(() => useMessages(), { wrapper: wrapper(fetcher) })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
  })

  it("returns stored history for the active conversation", async () => {
    useTurnStore.getState().selectConversation("c1")
    const { result } = renderHook(() => useMessages(), { wrapper: wrapper(async () => STORED) })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
  })

  it("appends optimistic user messages after stored history", async () => {
    useTurnStore.getState().selectConversation("c1")
    const { result, rerender } = renderHook(() => useMessages(), { wrapper: wrapper(async () => STORED) })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    useTurnStore.getState().appendOptimistic("new")
    rerender()
    expect(result.current.messages.map((m) => m.id)).toEqual(["m1", expect.stringMatching(/^local-/)])
  })

  it("appends the in-flight turn last, under the synthetic id", async () => {
    useTurnStore.getState().selectConversation("c1")
    const { result, rerender } = renderHook(() => useMessages(), { wrapper: wrapper(async () => STORED) })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    useTurnStore.getState().beginTurn()
    useTurnStore.getState().applyEvent({ type: "text-delta", delta: "hi" })
    rerender()
    expect(result.current.messages.at(-1)!.id).toBe(IN_FLIGHT_ID)
  })

  it("omits an in-flight turn that has produced no parts yet", async () => {
    useTurnStore.getState().selectConversation("c1")
    const { result, rerender } = renderHook(() => useMessages(), { wrapper: wrapper(async () => STORED) })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    useTurnStore.getState().beginTurn()
    rerender()
    expect(result.current.messages).toHaveLength(1)
  })

  it("returns a stable array identity across renders with no change", async () => {
    useTurnStore.getState().selectConversation("c1")
    const { result, rerender } = renderHook(() => useMessages(), { wrapper: wrapper(async () => STORED) })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    const first = result.current.messages
    rerender()
    expect(result.current.messages).toBe(first)
  })
})
```

- [ ] **Step 3: Run to confirm failure**

Run: `pnpm exec vitest run stores/turn.store.test.ts features/agent/use-messages.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Rewrite the turn store**

```ts
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { initialTurn, markCancelled, markInterrupted, reduceTurn, type TurnState } from "@/lib/agent/reducer"
import type { ChatMessageDto, SseEvent } from "@/lib/agent/types"

interface TurnStoreState {
  /** null means an unsent new chat — the backend mints the id on `start`. */
  activeId: string | null
  /** The turn currently being assembled from the stream, if any. */
  turn: TurnState | null
  /** User messages sent this session that SWR has not refetched yet. */
  optimistic: ChatMessageDto[]

  selectConversation: (id: string | null) => void
  appendOptimistic: (text: string) => void
  beginTurn: () => void
  applyEvent: (event: SseEvent) => void
  cancelTurn: () => void
  interruptTurn: (reason?: string) => void
  clearTurn: () => void
  /** Drops the finished turn and its optimistic rows, once SWR holds them. */
  settle: () => void
  reset: () => void
}

const EMPTY = { activeId: null, turn: null, optimistic: [] as ChatMessageDto[] }

/**
 * The client's half of a conversation.
 *
 * The rail and the stored history left for SWR — they are the server's truth and
 * they have cache keys. What stays is what only the client knows: which
 * conversation is open, the turn being assembled from the stream, and user
 * messages shown before a refetch has caught up.
 */
export const useTurnStore = create<TurnStoreState>()(
  immer((set) => ({
    ...EMPTY,

    // Switching conversations drops the in-flight turn's UI state. The caller is
    // responsible for aborting its stream first.
    selectConversation: (id) => set(() => ({ ...EMPTY, activeId: id })),

    appendOptimistic: (text) =>
      set((state) => {
        state.optimistic.push({
          // Local id: the server assigns its own, and history is refetched on
          // the next load. Prefixed so it can never collide with a real uuid.
          id: `local-${state.optimistic.length}-${text.length}`,
          role: "user",
          createdAt: new Date().toISOString(),
          parts: [{ type: "text", text }],
        })
      }),

    beginTurn: () =>
      set((state) => {
        state.turn = initialTurn(state.activeId)
      }),

    applyEvent: (event) =>
      set((state) => {
        if (!state.turn) return
        const next = reduceTurn(state.turn, event)
        state.turn = next
        // A first turn learns its conversation id from the `start` frame.
        if (next.conversationId) state.activeId = next.conversationId
      }),

    cancelTurn: () =>
      set((state) => {
        if (state.turn) state.turn = markCancelled(state.turn)
      }),

    interruptTurn: (reason) =>
      set((state) => {
        if (state.turn) state.turn = markInterrupted(state.turn, reason)
      }),

    clearTurn: () =>
      set((state) => {
        state.turn = null
      }),

    settle: () =>
      set((state) => {
        state.turn = null
        state.optimistic = []
      }),

    reset: () => set(() => ({ ...EMPTY })),
  })),
)

export const selectIsStreaming = (s: TurnStoreState): boolean => s.turn?.status === "streaming"
export const selectPendingApproval = (s: TurnStoreState) => s.turn?.approval ?? null
```

Note `reduceTurn` is called on a plain snapshot and its result assigned — the pure reducer is untouched, which is deliberate: it is the best-factored module in the client.

- [ ] **Step 5: Implement the read hooks**

Create `client/features/agent/use-conversations.ts`:

```ts
"use client"

import useSWR from "swr"
import { keys } from "@/lib/swr/keys"
import { rowsOf, type Paginated } from "@/lib/api/types"
import type { PublicConversation } from "@/lib/agent/types"

export function useConversations() {
  const { data, error, isLoading } = useSWR<Paginated<PublicConversation>>(keys.conversations())
  return { conversations: rowsOf(data), isLoading, error }
}
```

Create `client/features/agent/use-messages.ts`:

```ts
"use client"

import { useMemo } from "react"
import useSWR from "swr"
import { useShallow } from "zustand/react/shallow"
import { keys } from "@/lib/swr/keys"
import type { ChatMessageDto } from "@/lib/agent/types"
import { useTurnStore } from "@/stores/turn.store"

/** The synthetic id the in-flight turn renders under. */
export const IN_FLIGHT_ID = "in-flight"

/**
 * Stored history, plus what only the client knows about, as one list to render.
 *
 * The composition happens in a `useMemo` and never in a zustand selector: it
 * builds a new message object for the in-flight turn, so subscribing *through*
 * it would fail zustand v5's getSnapshot identity check and re-render forever —
 * even wrapped in `useShallow`, which compares array items by reference.
 */
export function useMessages() {
  const activeId = useTurnStore((s) => s.activeId)
  const optimistic = useTurnStore(useShallow((s) => s.optimistic))
  const turn = useTurnStore((s) => s.turn)

  const { data, error, isLoading } = useSWR<ChatMessageDto[]>(
    activeId ? keys.messages(activeId) : null,
  )

  const messages = useMemo<ChatMessageDto[]>(() => {
    const stored = data ?? []
    const base = optimistic.length === 0 ? stored : [...stored, ...optimistic]
    if (!turn || turn.parts.length === 0) return base
    return [...base, { id: IN_FLIGHT_ID, role: "assistant", createdAt: "", parts: turn.parts }]
  }, [data, optimistic, turn])

  return { messages, isLoading: Boolean(activeId) && isLoading, error }
}
```

- [ ] **Step 6: Add the turn store to the reset**

In `client/lib/state/reset.ts`, add `useTurnStore.getState().reset()` and its import. Add an assertion for it in `reset.test.ts`.

- [ ] **Step 7: Run and commit**

Run: `pnpm exec vitest run stores/turn.store.test.ts features/agent lib/state/reset.test.ts`
Expected: PASS. `terminal-window.test.tsx` will fail until Task 16 — note and continue.

```bash
git add -A
git commit -m "feat(agent): split conversation state into a turn store and swr reads"
```

---

## Task 16: `useAgentChat` and the terminal

**Files:**
- Create: `client/features/agent/use-agent-chat.ts` (replaces `components/terminal/use-agent-chat.ts`)
- Delete: `client/components/terminal/use-agent-chat.ts`
- Modify: `client/components/terminal/terminal-window.tsx`
- Modify: `client/components/terminal/terminal-window.test.tsx`

**Interfaces:**
- Consumes: `useTurnStore`, `useInvalidate`, `scopes` (Task 1), `streamChat` from `@/lib/agent/stream` (unchanged).
- Produces: `useAgentChat(): { openConversation(id: string | null): Promise<void>; sendMessage(text: string): Promise<void>; decideApproval(approvalId: string, approved: boolean): Promise<void>; stop(): void }`

- [ ] **Step 1: Write the failing test**

Add to `client/components/terminal/terminal-window.test.tsx` (keeping its existing cases):

```tsx
it("shows an optimistic user message before the stream produces anything", async () => {
  /* render TerminalWindow inside wrap(); type into the composer; submit;
     assert the typed text is on screen while the stream is still open */
})

it("revalidates the rail after a turn settles", async () => {
  /* assert a second GET /agent/conversations?page=1&limit=20 after the stream closes */
})
```

Fill both bodies using the file's existing render helper and its SSE stub.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run components/terminal/terminal-window.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the hook**

Create `client/features/agent/use-agent-chat.ts`:

```ts
"use client"

import { useCallback, useEffect, useRef } from "react"
import { useSWRConfig } from "swr"
import { streamChat } from "@/lib/agent/stream"
import type { ChatStreamRequest } from "@/lib/agent/types"
import { ApiError } from "@/lib/api/errors"
import { keys, scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { useSessionStore } from "@/stores/session.store"
import { useTurnStore } from "@/stores/turn.store"

/**
 * Owns one conversation's lifecycle: opening, streaming, and approvals.
 *
 * The multi-step flows live here rather than in components, so a view never
 * assembles "optimistic append → open stream → revalidate → refresh the rail".
 */
export function useAgentChat() {
  const { mutate } = useSWRConfig()
  const invalidate = useInvalidate()
  const abortRef = useRef<AbortController | null>(null)

  // Abort any in-flight turn when the window unmounts, so the socket is not
  // left open behind a closed terminal.
  useEffect(() => () => abortRef.current?.abort(), [])

  const openConversation = useCallback(
    async (id: string | null) => {
      // Switching away from a live turn must not leave its socket reading into
      // a store that has moved on.
      abortRef.current?.abort()
      useTurnStore.getState().selectConversation(id)
      if (id) await mutate(keys.messages(id))
    },
    [mutate],
  )

  /** Shared by a new message and by resuming after an approval. */
  const runStream = useCallback(
    async (body: ChatStreamRequest) => {
      const controller = new AbortController()
      abortRef.current = controller
      useTurnStore.getState().beginTurn()

      try {
        const result = await streamChat({
          baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
          getAccessToken: () => useSessionStore.getState().accessToken,
          body,
          signal: controller.signal,
          onEvent: (event) => useTurnStore.getState().applyEvent(event),
        })

        if (result.aborted) useTurnStore.getState().cancelTurn()
        else if (result.truncated) useTurnStore.getState().interruptTurn()
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "The agent could not be reached"
        // A pre-stream failure never produced a `done`, so mark it here.
        useTurnStore.getState().applyEvent({ type: "error", message })
      } finally {
        if (abortRef.current === controller) abortRef.current = null

        const { turn, activeId } = useTurnStore.getState()
        const status = turn?.status

        if (status && status !== "awaiting_approval") {
          // Revalidate first, settle second: clearing the turn before the
          // refetch lands would blink the reply off screen.
          if (activeId) await mutate(keys.messages(activeId))
          // A failed or interrupted turn keeps its state so the composer can
          // render the reason; only a finished one is folded away.
          if (status !== "failed" && status !== "interrupted") {
            useTurnStore.getState().settle()
          }
        }

        // The rail's titles and counts move with every turn.
        await invalidate(scopes.conversations())
      }
    },
    [mutate, invalidate],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const conversationId = useTurnStore.getState().activeId ?? undefined
      useTurnStore.getState().appendOptimistic(trimmed)
      await runStream(conversationId ? { conversationId, message: trimmed } : { message: trimmed })
    },
    [runStream],
  )

  /**
   * Decides an approval and continues the same turn.
   *
   * This is the inline path — `POST /agent/chat/stream` with a `resume` body —
   * not `POST /agent/approvals/:id`. The two are not interchangeable: only this
   * one streams the rest of the turn back.
   */
  const decideApproval = useCallback(
    async (approvalId: string, approved: boolean) => {
      const conversationId = useTurnStore.getState().activeId ?? undefined
      // The paused turn is replaced by the resumed one.
      useTurnStore.getState().clearTurn()
      await runStream(
        conversationId
          ? { conversationId, resume: { approvalId, approved } }
          : { resume: { approvalId, approved } },
      )
    },
    [runStream],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { openConversation, sendMessage, decideApproval, stop }
}
```

Note the settle change: a `failed` or `interrupted` turn is now kept, because `TerminalWindow` renders `turn.error` for exactly those two statuses and the previous implementation cleared the turn in `finally` before that text could ever appear.

- [ ] **Step 4: Rewire the terminal**

In `terminal-window.tsx`, replace the store subscriptions with the three feature hooks:

```tsx
const { openConversation, sendMessage, decideApproval, stop } = useAgentChat()
const { conversations, isLoading: railLoading, error: railError } = useConversations()
const { messages, isLoading: messagesLoading, error: messagesError } = useMessages()
const activeId = useTurnStore((s) => s.activeId)
const turn = useTurnStore((s) => s.turn)
const approval = useTurnStore(selectPendingApproval)
```

Delete the `useEffect` that called `loadConversations()` — SWR fetches the rail on mount. Map `railLoading`/`railError` onto `ConversationRail`'s existing `status`/`error` props.

- [ ] **Step 5: Run and commit**

Run: `pnpm test && pnpm run typecheck && pnpm run lint`

```bash
git add -A
git commit -m "feat(agent): drive the terminal from swr reads and a streaming turn store"
```

---

## Task 17: `useDomainTable` on SWR

**Files:**
- Create: `client/features/records/use-domain-table.ts`
- Delete: `client/components/data-table/use-domain-table.ts`
- Modify: `client/components/data-table/data-table.tsx`, `client/components/data-table/table-state.tsx` (import path only)
- Modify: `client/components/data-table/data-table.test.tsx`

**Interfaces:**
- Consumes: `keys.list`, `scopes.allLists`, `useInvalidate`.
- Produces: `useDomainTable<T>(config: DomainTableConfig<T>): DomainTable<T>` — same return shape as today (`rows`, `total`, `status`, `error`, `query`, `setQuery`, `setFilter`, `refresh`), **minus** the `refreshToken` parameter.

- [ ] **Step 1: Write the failing test**

Add to `client/components/data-table/data-table.test.tsx`:

```tsx
it("issues one request per distinct query and none per re-render", async () => {
  /* render, wait for rows, rerender twice, assert fetchImpl call count is 1 */
})

it("returns to page one when a filter narrows the list", async () => {
  /* page to 2, apply a status filter, assert the request carries page=1 */
})
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run components/data-table/data-table.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement it**

Create `client/features/records/use-domain-table.ts`:

```ts
"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { rowsOf, type Paginated } from "@/lib/api/types"
import { keys, scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { clampPage, initialQuery, type TableQuery } from "@/components/data-table/query"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"

export type TableStatus = "idle" | "loading" | "ready" | "error"

export interface DomainTable<T> {
  rows: T[]
  total: number
  status: TableStatus
  error: string | null
  query: TableQuery
  setQuery: (patch: Partial<TableQuery>) => void
  setFilter: (key: string, value: string) => void
  refresh: () => void
}

/**
 * Server-paginated data for one domain.
 *
 * The query is local state — it belongs to this window, and two open Contacts
 * windows should be able to sit on different pages. Only the fetch is shared,
 * through a cache key derived from that query.
 *
 * The previous implementation carried a `requestSeq` ref to discard
 * out-of-order responses while typing in the search box. That guard is gone
 * because it is no longer needed: SWR keys a response to the query that asked
 * for it, so a slow response cannot land in a newer query's slot.
 */
export function useDomainTable<T extends HasId>(config: DomainTableConfig<T>): DomainTable<T> {
  const [query, setQueryState] = useState<TableQuery>(() => initialQuery(config.tabs))
  const invalidate = useInvalidate()

  const { data, error, isLoading } = useSWR<Paginated<T>>(
    keys.list(config.endpoint, query, config.tabs),
  )

  const total = data?.total ?? 0

  const setQuery = useCallback((patch: Partial<TableQuery>) => {
    setQueryState((q) => {
      const next = { ...q, ...patch }
      // Any change other than the page itself returns to page 1 — otherwise a
      // narrowed filter leaves the user on a page that no longer exists.
      if (patch.page === undefined) next.page = 1
      return next
    })
  }, [])

  const setFilter = useCallback(
    (key: string, value: string) =>
      setQueryState((q) => ({ ...q, page: 1, filters: { ...q.filters, [key]: value } })),
    [],
  )

  const refresh = useCallback(() => {
    // Re-clamp first: a delete can empty the last page.
    setQueryState((q) => ({ ...q, page: clampPage(q.page, total, q.limit) }))
    void invalidate(scopes.allLists(config.endpoint))
  }, [config.endpoint, invalidate, total])

  return {
    rows: rowsOf(data),
    total,
    status: error ? "error" : isLoading ? "loading" : "ready",
    error: error instanceof Error ? error.message : error ? "Could not load this list" : null,
    query,
    setQuery,
    setFilter,
    refresh,
  }
}
```

- [ ] **Step 4: Drop `refreshToken` from the table component and its two callers**

In `data-table.tsx` remove the `refreshToken` prop from `DataTableProps` and from the `useDomainTable` call, and update its import to `@/features/records/use-domain-table`. Update `table-state.tsx`'s `TableStatus` import likewise.

Then remove the now-unsatisfiable prop from both callers, or this task cannot typecheck:

- `contacts-window.tsx`: delete `refreshToken={refreshToken}` and the `const [refreshToken, setRefreshToken] = useState(0)` line. Leave the `onDone: () => setRefreshToken(...)` entry in the confirm props for now — Task 18 removes it along with the whole callback protocol. Replace its body with `() => undefined` so it still compiles.
- `files-window.tsx`: delete `refreshToken={refreshToken}`, the `useState` counter, and the `refresh` callback; drop `refresh` from the `useMemo` dependency array and pass `onUploaded={() => undefined}` to `FileDropzone` for now — Task 19 removes that prop entirely.

- [ ] **Step 5: Run and commit**

Run: `pnpm test && pnpm run typecheck`

```bash
git rm components/data-table/use-domain-table.ts
git add -A
git commit -m "feat(records): fetch domain tables through swr"
```

---

## Task 18: Record mutations — defects #2 and #5

Creating or editing a contact currently closes its window and leaves the list showing stale data, because `ContactsWindow` passes `onDone` only on delete. `FilesWindow` never passes it at all.

**Files:**
- Create: `client/features/records/use-record.ts`, `client/features/records/use-record-mutations.ts`
- Modify: `client/components/data-table/record-window.tsx`, `client/components/windows/confirm-window.tsx`
- Modify: `client/components/domains/contacts-window.tsx`, `client/components/domains/files-window.tsx`
- Test: `client/features/records/use-record-mutations.test.tsx`

**Interfaces:**
- Produces:
  - `useRecord(endpoint: string, id?: string): { record: Record<string, unknown> | null; isLoading: boolean; error: unknown }`
  - `useRecordMutations(endpoint: string): { create(body): Promise<void>; update(id, body): Promise<void>; remove(ids: string[]): Promise<{ deleted: number; failed: number; firstError: unknown }> }`

- [ ] **Step 1: Write the failing test**

Create `client/features/records/use-record-mutations.test.tsx` asserting:

```tsx
it("invalidates every cached page of the domain after a create", async () => { /* ... */ })
it("invalidates the record and the lists after an update", async () => { /* ... */ })
it("reports partial failure honestly when some deletes reject", async () => { /* ... */ })
it("leaves another domain's cache untouched", async () => { /* ... */ })
```

Use `renderHook` with an `SWRConfig` whose `provider` is a pre-seeded `Map` holding `keys.list("/contacts", initialQuery())` and `keys.list("/files", initialQuery())`, then assert which entries were revalidated by counting fetcher calls per key.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run features/records/use-record-mutations.test.tsx`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement the hooks**

Create `client/features/records/use-record.ts`:

```ts
"use client"

import useSWR from "swr"
import { keys } from "@/lib/swr/keys"

export function useRecord(endpoint: string, id?: string) {
  const { data, error, isLoading } = useSWR<Record<string, unknown>>(
    id ? keys.record(endpoint, id) : null,
    // `keepPreviousData` is ON globally (provider.tsx) because the domain tables
    // want it for pagination. It is WRONG for any hook whose key identifies
    // WHICH entity is being shown: SWR's laggyDataRef has no guard for a null
    // key, so this would return the PREVIOUS record — or the last one viewed,
    // after the id goes undefined. The same bug has already bitten useSession
    // and useMessages.
    { keepPreviousData: false },
  )
  return { record: data ?? null, isLoading: Boolean(id) && isLoading, error }
}
```

Create `client/features/records/use-record-mutations.ts`:

```ts
"use client"

import { useCallback } from "react"
import { useApi } from "@/lib/swr/provider"
import { scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"

export interface DeleteOutcome {
  deleted: number
  failed: number
  firstError: unknown
}

/**
 * Writes for one domain, each followed by the invalidation it implies.
 *
 * Invalidating by prefix is what makes a second window showing the same domain
 * update too. The previous design threaded an `onDone` callback down through the
 * window store's props, which meant only the opener ever learned about a change
 * — and only when the opener remembered to pass one, which Contacts did for
 * deletes and not for creates or edits.
 */
export function useRecordMutations(endpoint: string) {
  const { client } = useApi()
  const invalidate = useInvalidate()

  const create = useCallback(
    async (body: unknown) => {
      await client.post(endpoint, body)
      await invalidate(scopes.allLists(endpoint))
    },
    [client, endpoint, invalidate],
  )

  const update = useCallback(
    async (id: string, body: unknown) => {
      await client.patch(`${endpoint}/${id}`, body)
      await Promise.all([
        invalidate(scopes.allLists(endpoint)),
        invalidate(scopes.allRecords(endpoint)),
      ])
    },
    [client, endpoint, invalidate],
  )

  /**
   * Deletes are issued one request per id — the API exposes no bulk delete —
   * and partial failure is reported rather than swallowed: with five rows
   * selected, "3 of 5 deleted" is the honest outcome.
   */
  const remove = useCallback(
    async (ids: string[]): Promise<DeleteOutcome> => {
      const results = await Promise.allSettled(ids.map((id) => client.del(`${endpoint}/${id}`)))
      const rejected = results.filter((r) => r.status === "rejected")

      await Promise.all([
        invalidate(scopes.allLists(endpoint)),
        invalidate(scopes.allRecords(endpoint)),
      ])

      return {
        deleted: ids.length - rejected.length,
        failed: rejected.length,
        firstError: (rejected[0] as PromiseRejectedResult | undefined)?.reason,
      }
    },
    [client, endpoint, invalidate],
  )

  return { create, update, remove }
}
```

- [ ] **Step 4: Rewire the two window bodies**

`record-window.tsx`: replace the manual `useEffect` load with `useRecord(endpoint, id)`, replace the save branch with `useRecordMutations(endpoint)`, and delete the `onDone` prop from `RecordWindowProps`.

`confirm-window.tsx`: replace the inline `Promise.allSettled` with `remove(ids)` and render the returned `DeleteOutcome`; delete the `onDone` prop.

- [ ] **Step 5: Drop the callback props from the domain windows**

`contacts-window.tsx` and `files-window.tsx` lose the `onDone` entry in the confirm `props` (Task 17 already removed their `refreshToken` counters). Make `FileDropzone`'s prop optional — `onUploaded?: () => void` — and stop passing it from `FilesWindow`; Task 19 deletes the prop outright.

- [ ] **Step 6: Narrow window props to JSON, now that the last callback is gone**

In `client/lib/windows/types.ts`, change `WindowInstance.props` to `JsonObject` and import it from `@/lib/state/json`:

```ts
  /**
   * JSON-only, because instances are persisted. Typing this as JsonObject turns
   * "a callback silently vanished through JSON.stringify" into a compile error.
   */
  props?: JsonObject
```

Apply the same type to `OpenWindowInput.props` in `workspace.store.ts`.

Run: `pnpm run typecheck`
Expected: PASS. If it reports a `props` object still carrying a function, that is the check working — remove the callback rather than widening the type back.

- [ ] **Step 7: Run and commit**

Run: `pnpm test && pnpm run lint`

```bash
git add -A
git commit -m "fix(records): refresh lists by cache invalidation instead of callback props

Creating or editing a contact left every open list stale, because only the
delete path threaded an onDone callback through the window store. Removing
the last callback prop also lets WindowInstance.props be JSON-typed."
```

---

## Task 19: Upload feature hook

**Files:**
- Create: `client/features/files/use-file-uploads.ts`
- Modify: `client/components/domains/file-dropzone.tsx`

**Interfaces:**
- Produces: `useFileUploads(): { items: UploadItem[]; start(files: FileList | File[]): Promise<void>; remove(localId): void; clearSettled(): void }`

- [ ] **Step 1: Write the failing test**

Create `client/features/files/use-file-uploads.test.tsx` asserting that reaching the `indexed` phase invalidates `["list", "/files"]` and that a `failed` upload does not.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run features/files/use-file-uploads.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement it**

```ts
"use client"

import { useCallback } from "react"
import { nanoid } from "nanoid"
import { useShallow } from "zustand/react/shallow"
import { isIngestable, uploadFile } from "@/lib/files/upload"
import { scopes } from "@/lib/swr/keys"
import { useApi } from "@/lib/swr/provider"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { useUploadStore } from "@/stores/upload.store"

const FILES_ENDPOINT = "/files"

/**
 * Uploads, and the list refresh each finished one implies.
 *
 * The dropzone used to call an `onUploaded` prop that its parent turned into a
 * `refreshToken` counter, so only the Files window that owned the dropzone ever
 * saw new rows.
 */
export function useFileUploads() {
  const { client } = useApi()
  const invalidate = useInvalidate()
  const items = useUploadStore(useShallow((s) => s.items))

  const start = useCallback(
    async (files: FileList | File[]) => {
      const store = useUploadStore.getState()
      await Promise.all(
        Array.from(files).map(async (file) => {
          const localId = nanoid()
          const mimeType = file.type || "application/octet-stream"
          store.add({
            localId,
            filename: file.name,
            size: file.size,
            mimeType,
            phase: "queued",
            percent: 0,
            ingestable: isIngestable(mimeType),
          })
          await uploadFile({
            client,
            file,
            onProgress: (p) => useUploadStore.getState().update(localId, p),
          })
        }),
      )
      // Only when something actually landed. `uploadFile` NEVER rejects — it
      // catches internally and returns null on failure (lib/files/upload.ts:206,
      // 213, 229, 236) — so an unconditional invalidate here would refetch the
      // list even when every upload failed.
      if (results.some((r) => r !== null)) {
        await invalidate(scopes.allLists(FILES_ENDPOINT))
      }
    },
    [client, invalidate],
  )

  return {
    items,
    start,
    remove: useUploadStore((s) => s.remove),
    clearSettled: useUploadStore((s) => s.clearSettled),
  }
}
```

- [ ] **Step 4: Rewire the dropzone**

`file-dropzone.tsx` drops its `onUploaded` prop, its `useApi`/store subscriptions and its local `start`, and uses `useFileUploads()`. The `dragging` boolean stays local — it is presentation state for one element.

- [ ] **Step 5: Run and commit**

Run: `pnpm test && pnpm run typecheck`

```bash
git add -A
git commit -m "feat(files): invalidate the files list from the upload hook"
```

---

## Task 20: Workspace facade and the viewport throttle — defect #4

**Files:**
- Create: `client/features/workspace/use-workspace.ts`, `client/features/workspace/use-window-controls.ts`, `client/features/workspace/use-scene-controls.ts`
- Modify: `client/components/windows/window-layer.tsx`, `client/components/windows/dock.tsx`, `client/components/shell/shell-chrome.tsx`, `client/app/core/core-shell.tsx`, `client/components/system-core/system-core-canvas.tsx`
- Test: `client/features/workspace/use-workspace.test.tsx`

**Interfaces:**
- Produces:
  - `useWorkspace(): { windows: WindowInstance[]; minimised: WindowInstance[]; topModal: WindowInstance | null; openWindow(input): string }`
  - `useWindowControls(id: string): { close(); focus(); minimise(); restore(); toggleMaximise(); move(rect) }`
  - `useSceneControls(): { panelOpen; scannerVisible; resetToken; togglePanel(); toggleScanner(); resetView() }`
  - `useViewportSync(): void` — rAF-throttled resize listener

- [ ] **Step 1: Write the failing test**

Create `client/features/workspace/use-workspace.test.tsx`:

```tsx
it("coalesces a burst of resize events into a single viewport write", async () => {
  /* renderHook(useViewportSync); dispatch 20 resize events synchronously;
     await one animation frame; assert setViewport ran once */
})

it("returns open windows sorted by z-index, minimised excluded", () => { /* ... */ })
it("returns a stable array identity when nothing changed", () => { /* ... */ })
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm exec vitest run features/workspace/use-workspace.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the facade**

```ts
// features/workspace/use-workspace.ts
"use client"

import { useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { selectMinimised, selectOpenWindows, selectTopModal, useWorkspaceStore } from "@/stores/workspace.store"
import { useViewportStore } from "@/stores/viewport.store"

export function useWorkspace() {
  // useShallow is required, not stylistic: these selectors filter and sort, so
  // they return a NEW array reference on every call. Under zustand v5 that
  // fails the getSnapshot identity check and re-renders forever.
  const windows = useWorkspaceStore(useShallow(selectOpenWindows))
  const minimised = useWorkspaceStore(useShallow(selectMinimised))
  const topModal = useWorkspaceStore(selectTopModal)
  const openWindow = useWorkspaceStore((s) => s.openWindow)
  return { windows, minimised, topModal, openWindow }
}

/**
 * Keeps the viewport store in step with the window, one write per frame.
 *
 * `resize` fires far faster than a frame while a window edge is dragged. That
 * mattered more than it looks: the workspace store persists, and `persist`
 * writes after every `setState` with no diff against `partialize`, so an
 * unthrottled listener serialised the whole window array per event.
 */
export function useViewportSync(): void {
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const sync = () => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        useViewportStore.getState().setViewport({ w: window.innerWidth, h: window.innerHeight })
      })
    }

    sync()
    window.addEventListener("resize", sync)
    return () => {
      window.removeEventListener("resize", sync)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])
}
```

`use-window-controls.ts` returns the six per-window actions bound to an id; `use-scene-controls.ts` is a thin pass-through over `useSceneStore`.

- [ ] **Step 4: Rewire the five consumers**

- `window-layer.tsx`: `useWorkspace()` + `useViewportSync()`; per-window handlers from `useWindowControls(win.id)`.
- `dock.tsx`: `useWorkspace()` for `minimised`, `useWindowControls` for restore/focus.
- `shell-chrome.tsx`: `useWorkspace().openWindow`, `useSceneControls()`; delete the five scene props from `ShellChromeProps`.
- `core-shell.tsx`: delete the `useState` trio and the prop passing; read `useSceneControls()` for the canvas.
- `system-core-canvas.tsx`: `useWorkspace().openWindow`.

- [ ] **Step 5: Run and commit**

Run: `pnpm test && pnpm run typecheck && pnpm run lint`

```bash
git add -A
git commit -m "fix(workspace): throttle viewport sync and expose the workspace as feature hooks

An unthrottled resize listener wrote the whole persisted window array to
localStorage on every event, because zustand persist writes after every
setState regardless of what partialize selects."
```

---

## Task 21: Enforce the facade and verify

**Files:**
- Modify: `client/eslint.config.mjs`
- Modify: any component still importing a store, `swr`, or `@/lib/api/*` directly

- [ ] **Step 1: Add the restricted-import zone**

In `client/eslint.config.mjs`, append to the exported array:

```js
{
  files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  ignores: ["**/*.test.{ts,tsx}", "app/providers.tsx"],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["@/stores/*", "swr", "@/lib/api/*"],
          message:
            "UI components consume features/**, not state directly. Add or extend a hook in features/ instead.",
        },
      ],
    }],
  },
},
```

`app/providers.tsx` is exempt because wiring the provider is precisely the job of composing state.

- [ ] **Step 2: Run the linter and see the violations**

Run: `pnpm run lint`
Expected: errors listing every component still reaching past the facade.

- [ ] **Step 3: Fix each violation**

For each, either use an existing feature hook or add the missing one. Do **not** widen the ignore list.

- [ ] **Step 4: Full verification**

Run each and confirm the output before claiming completion:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run build
```

Expected: lint clean, no type errors, all tests pass, production build succeeds.

- [ ] **Step 5: Confirm the defect fixes by hand**

Run `pnpm run dev` and check each:

1. The confirm dialog renders at 420×220 and the record windows at 460×600, not 900×600; the terminal refuses to resize below 420×320. The auth gate stays a centred, frameless card (chrome `"none"`) — unchanged by this work.
2. Create a contact → the list shows it without a manual refresh. Open two Contacts windows, delete in one → both update.
3. Sign out, sign in as another user → the conversation rail and upload list are empty.
4. With DevTools → Application → Local Storage open, drag the browser window edge → `cyb.windows` is not written on every event.
5. Sign in with a session created *before* this branch → still signed in after reload (legacy `cyb.refresh` upgraded).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(lint): restrict UI imports to the features facade"
```

---

## Self-Review

**Spec coverage.** §4 → Task 1. §5.1 → the file structure above, all files assigned. §6.1/§6.2 → Task 1, Task 10. §6.3/§6.4 → Task 10, Task 11. §7.1 → Tasks 4, 6, 8, 13, 15. §7.2 → Task 3 (renamed per the deviation note). §7.3 → Tasks 4, 6, 20. §7.4 → Tasks 2, 3. §7.5 → Task 14. §8 → Tasks 13, 14. §8.1 → Task 12. §9.1/§9.2 → Task 7. §9.3 → Tasks 4, 20. §10.1 → Tasks 15, 16. §10.2 → Tasks 17, 18. §10.3 → Tasks 8, 19. §11 → defects 1/2/3/4/5 land in Tasks 7/18/12/20/18 respectively and are verified in Task 21 Step 5. §12 → Task 21. §13 → every task carries its tests; the rewritten/updated/unchanged split matches. §14 out-of-scope items appear in no task. §15 risks: legacy migration is Tasks 2–3 (built first, pure, before any dependant), retry stacking is Task 11 Step 1 test 2, hydration ordering is Task 14, renames are Tasks 5 and 9 as isolated commits, `authed` semantics are Task 13's test suite.

**Placeholder scan.** Task 16 Step 1, Task 17 Step 1, Task 18 Step 1, Task 19 Step 1 and Task 20 Step 1 give test names with described bodies rather than full code, because each needs the target file's existing render helper and stubs, which differ per file. Every one names the exact assertion to make. All other steps carry complete code.

**Type consistency.** `useWorkspaceStore` / `useSessionStore` / `useTurnStore` / `useUploadStore` / `useViewportStore` / `useSceneStore` are used under those names from their introducing task onward. `openWindow(input: OpenWindowInput)` keeps its object-argument shape throughout (Task 7 defines it; Tasks 14, 18, 20 call it). `resetClientState(mutate)` takes the same nullable `Mutator` in Tasks 12, 15 and 16. `WindowInstance.minSize` is written in Task 7 and read in Task 7 Step 7. `scopes.allLists` / `scopes.allRecords` / `scopes.conversations` are defined in Task 1 and used in Tasks 16, 17, 18, 19. `DomainTable<T>` drops `refreshToken` in Task 17 and no later task passes one.
