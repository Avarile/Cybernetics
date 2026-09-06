# Cybernetics Client — Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Cybernetics client you can log into, that renders concurrent draggable windows over a placeholder canvas, backed by a token-refreshing API client.

**Architecture:** Next 16 App Router, single authenticated route (`/core`). A zustand window registry drives a portal layer of non-modal floating windows; Radix `Dialog` is reserved for modal auth. All network traffic goes through one `fetch` wrapper that owns bearer tokens and single-flight refresh.

**Tech Stack:** Next 16 · React 19.2 · TypeScript (strict) · Tailwind v4 · shadcn (`radix-vega`/olive) · zustand · Vitest + Testing Library

**Spec:** `development/current_session/current_design.md`

## Global Constraints

- **API base URL has no prefix.** `NEXT_PUBLIC_API_URL` is the bare origin. The API calls `setGlobalPrefix` nowhere.
- **Bearer only.** Never send `credentials: 'include'`; the API sets `credentials: false` in CORS.
- **Access token in memory only.** Never written to `localStorage`/`sessionStorage`. Only the refresh token is persisted.
- **Refresh must be single-flight.** `auth.service.ts` uses compare-and-set rotation (`claimForRotation`); two parallel refreshes with the same token revoke the entire token family. This is correctness, not performance.
- **Mirror, don't import.** The client never imports from `api/`. Backend types are hand-copied with a comment citing the source file.
- **Canvas colours are exempt from theme tokens** (design §4.3). Everything outside the canvas uses semantic shadcn tokens only.
- **`use client`** on every component using hooks, state, or browser APIs. Next 16 App Router defaults to server components.
- Package manager is **pnpm** (`pnpm-lock.yaml`, `pnpm-workspace.yaml` present).
- Path alias is `@/*` → `client/*`.

## Phase map

This plan covers **Phase 1 only**. Later phases are planned when reached.

| Phase | Content | Design §  |
|---|---|---|
| **1 (this plan)** | Monorepo fold + test harness, API client + refresh, auth, window manager, shell | §2, §3, §5, §10 |
| 2 | 3D System Core: port `objects/`+`scene/`, author `data/`, `useDomainHealth` | §4 |
| 3 | Terminal + SSE stream transport + approvals | §6 |
| 4 | Generic data table + domains + file upload/ingest | §8, §9 |
| 5 | Voice window + Web Speech adapter; responsive/a11y pass | §7, §2.3 |

**Phase 1 is done when:** you can `pnpm dev`, log in with real credentials against a running API, open three windows, drag/resize/minimise them, reload, and find your session and window layout restored.

---

## File structure

| File | Responsibility |
|---|---|
| `client/vitest.config.ts` | Test runner config, jsdom env, `@/*` alias |
| `client/test/setup.ts` | Testing Library matchers, per-test cleanup |
| `client/lib/api/errors.ts` | `ApiError`, `ErrorCode`, envelope parsing |
| `client/lib/api/types.ts` | Hand-mirrored backend DTOs |
| `client/lib/api/client.ts` | The only module that knows tokens, refresh, base URL |
| `client/lib/api/endpoints/auth.ts` | Typed wrappers over `/auth/*` |
| `client/lib/windows/types.ts` | `WindowKind`, `WindowInstance`, `WindowDescriptor` |
| `client/lib/windows/geometry.ts` | Cascade offset + viewport clamp (pure) |
| `client/lib/windows/registry.ts` | `WindowKind` → descriptor + lazy component |
| `client/stores/auth.store.ts` | Principal, tokens, auth status |
| `client/stores/window.store.ts` | Window instances, z-order, focus, dock |
| `client/components/windows/use-drag-resize.ts` | Pointer maths for drag + resize |
| `client/components/windows/window-frame.tsx` | All window chrome; floating vs `Sheet` |
| `client/components/windows/window-layer.tsx` | Portal, z-sorted render of open windows |
| `client/components/windows/dock.tsx` | Minimised-window strip |
| `client/components/auth/auth-window.tsx` | Modal auth window, pane switching |
| `client/components/auth/sign-in-pane.tsx` | Email/password form |
| `client/components/auth/forgot-pane.tsx` | Forgot-password form |
| `client/components/auth/register-pane.tsx` | Flag-gated register form |
| `client/components/shell/shell-chrome.tsx` | Top bar, avatar menu, voice FAB slot |
| `client/app/core/page.tsx` | The app: canvas slot + window layer + chrome |
| `client/app/page.tsx` | Modify → redirect to `/core` |

---

## Task 1: Fold `client/` into the monorepo and add the test harness

`client/` currently has its own `.git` (one scaffold commit, no remote) and the parent repo sees it as untracked. Every later task commits to the parent, so this must come first. There is also no test runner, so no TDD cycle is possible until Vitest exists.

**Files:**
- Delete: `client/.git`
- Create: `client/vitest.config.ts`, `client/test/setup.ts`, `client/test/sanity.test.ts`
- Modify: `client/package.json`, `.gitignore` (parent)

**Interfaces:**
- Consumes: nothing
- Produces: `pnpm --dir client test` runs Vitest; `@/` resolves in tests

- [x] **Step 1: Confirm the nested repo holds nothing worth keeping**

```bash
cd client && git log --oneline && git status --short
```

Expected: exactly one commit `feat: initial commit`, plus uncommitted scaffold edits. If there is more history than that, **stop and ask** — the fold discards it.

- [x] **Step 2: Remove the nested repo**

```bash
cd /Users/avarilewang/Documents/codeRepo/typescript/Cybernetics
rm -rf client/.git
git status --short client | head -3
```

Expected: parent still reports `?? client/`, now with no nested repo inside.

- [x] **Step 3: Ignore build artefacts before the first add**

Append to the parent `.gitignore` (create the entries if absent):

```gitignore
# client
client/.next/
client/node_modules/
client/tsconfig.tsbuildinfo
client/.claude-flow/
```

- [x] **Step 4: Install test dependencies**

```bash
pnpm --dir client add -D vitest @vitejs/plugin-react jsdom \
  @testing-library/react @testing-library/dom @testing-library/user-event \
  @testing-library/jest-dom
```

- [x] **Step 5: Write the Vitest config**

`client/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next"],
  },
})
```

- [x] **Step 6: Write the test setup**

`client/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
  localStorage.clear()
})
```

- [x] **Step 7: Add the test scripts and move the dev server off port 3000**

The API defaults to `PORT=3000` (`api/src/config/env.validation.ts`) and so does
`next dev` — they collide. Pin the client to 3100 rather than relying on Next's
auto-shift, which silently changes the origin the API's CORS allowlist sees.

In `client/package.json` `"scripts"`, set `dev`/`start` and add the test scripts:

```json
"dev": "next dev -p 3100",
"start": "next start -p 3100",
"test": "vitest run",
"test:watch": "vitest"
```

- [x] **Step 8: Write a sanity test that proves the alias and jsdom work**

`client/test/sanity.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { cn } from "@/lib/utils"

describe("test harness", () => {
  it("resolves the @/ alias", () => {
    expect(cn("a", "b")).toContain("a")
  })

  it("provides a DOM", () => {
    document.body.innerHTML = "<main id='x'>ok</main>"
    expect(document.getElementById("x")?.textContent).toBe("ok")
  })
})
```

- [x] **Step 9: Run it**

```bash
pnpm --dir client test
```

Expected: PASS, 2 tests.

- [x] **Step 10: Verify the existing build still works**

```bash
pnpm --dir client typecheck && pnpm --dir client build
```

Expected: both succeed. If `build` fails on the stock demo pages, note it — Task 12 replaces them.

- [x] **Step 11: Commit the fold**

```bash
cd /Users/avarilewang/Documents/codeRepo/typescript/Cybernetics
git add .gitignore client
git commit -m "$(cat <<'EOF'
chore(client): fold client into the monorepo and add Vitest

client/ was a standalone git repo created by the Next scaffold, invisible
to the parent repo. Removes the nested .git and tracks it alongside api/.

Adds Vitest + Testing Library so the frontend has a TDD cycle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: API error types

Every later network call parses this envelope. Its shape is fixed by `api/src/infrastructure/exceptions/error-envelope.ts`.

**Files:**
- Create: `client/lib/api/errors.ts`, `client/lib/api/errors.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `class ApiError extends Error { code: string; statusCode: number; details: unknown; correlationId?: string }`
  - `parseErrorEnvelope(status: number, body: unknown): ApiError`
  - `const ErrorCodes` — the string constants the client branches on

- [x] **Step 1: Write the failing test**

`client/lib/api/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { ApiError, ErrorCodes, parseErrorEnvelope } from "./errors"

describe("parseErrorEnvelope", () => {
  it("reads a well-formed envelope", () => {
    const err = parseErrorEnvelope(401, {
      error: {
        code: "AUTH_TOKEN_EXPIRED",
        message: "Access token expired",
        statusCode: 401,
        details: null,
        correlationId: "abc-123",
        timestamp: "2026-09-06T00:00:00.000Z",
        path: "/auth/me",
      },
    })
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_EXPIRED)
    expect(err.statusCode).toBe(401)
    expect(err.correlationId).toBe("abc-123")
    expect(err.message).toBe("Access token expired")
  })

  it("falls back when the body is not an envelope", () => {
    const err = parseErrorEnvelope(502, "<html>bad gateway</html>")
    expect(err.code).toBe("UNKNOWN")
    expect(err.statusCode).toBe(502)
    expect(err.message).toMatch(/502/)
  })

  it("falls back when the body is null", () => {
    const err = parseErrorEnvelope(500, null)
    expect(err.code).toBe("UNKNOWN")
    expect(err.statusCode).toBe(500)
  })

  it("keeps details for non-internal errors", () => {
    const err = parseErrorEnvelope(422, {
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid",
        statusCode: 422,
        details: { fieldErrors: { email: ["required"] } },
        correlationId: "c",
        timestamp: "t",
        path: "/auth/login",
      },
    })
    expect(err.details).toEqual({ fieldErrors: { email: ["required"] } })
  })

  it("isAuthExpiry only matches the expiry code", () => {
    const expired = parseErrorEnvelope(401, {
      error: { code: "AUTH_TOKEN_EXPIRED", message: "", statusCode: 401, details: null, correlationId: "", timestamp: "", path: "" },
    })
    const invalid = parseErrorEnvelope(401, {
      error: { code: "AUTH_TOKEN_INVALID", message: "", statusCode: 401, details: null, correlationId: "", timestamp: "", path: "" },
    })
    expect(expired.isAuthExpiry()).toBe(true)
    expect(invalid.isAuthExpiry()).toBe(false)
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test lib/api/errors
```

Expected: FAIL — `Failed to resolve import "./errors"`.

- [x] **Step 3: Implement**

`client/lib/api/errors.ts`:

```ts
/**
 * Mirrors `api/src/infrastructure/exceptions/error-envelope.ts` and the codes in
 * `error-codes.ts`. Hand-copied on purpose: the client does not import from api/.
 */

export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_TOKEN_INVALID: "AUTH_TOKEN_INVALID",
  AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  AUTH_TOKEN_REUSE: "AUTH_TOKEN_REUSE",
  AUTH_RESET_CODE_INVALID: "AUTH_RESET_CODE_INVALID",
  FILE_TOO_LARGE: "FILE_TOO_LARGE",
  FILE_MIME_NOT_ALLOWED: "FILE_MIME_NOT_ALLOWED",
  UNKNOWN: "UNKNOWN",
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes] | string

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly statusCode: number
  readonly details: unknown
  readonly correlationId?: string

  constructor(init: {
    code: ErrorCode
    message: string
    statusCode: number
    details?: unknown
    correlationId?: string
  }) {
    super(init.message)
    this.name = "ApiError"
    this.code = init.code
    this.statusCode = init.statusCode
    this.details = init.details ?? null
    this.correlationId = init.correlationId
  }

  /** The one code that should trigger a refresh-and-retry. */
  isAuthExpiry(): boolean {
    return this.code === ErrorCodes.AUTH_TOKEN_EXPIRED
  }
}

interface EnvelopeShape {
  error: {
    code: string
    message: string
    statusCode: number
    details?: unknown
    correlationId?: string
  }
}

function isEnvelope(body: unknown): body is EnvelopeShape {
  if (typeof body !== "object" || body === null) return false
  const e = (body as { error?: unknown }).error
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { code?: unknown }).code === "string"
  )
}

export function parseErrorEnvelope(status: number, body: unknown): ApiError {
  if (isEnvelope(body)) {
    const e = body.error
    return new ApiError({
      code: e.code,
      message: e.message || `Request failed (${status})`,
      statusCode: e.statusCode || status,
      details: e.details,
      correlationId: e.correlationId,
    })
  }
  return new ApiError({
    code: ErrorCodes.UNKNOWN,
    message: `Request failed (${status})`,
    statusCode: status,
  })
}
```

- [x] **Step 4: Run it and watch it pass**

```bash
pnpm --dir client test lib/api/errors
```

Expected: PASS, 5 tests.

- [x] **Step 5: Commit**

```bash
git add client/lib/api/errors.ts client/lib/api/errors.test.ts
git commit -m "feat(client): add ApiError and error-envelope parsing

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: API client with single-flight refresh

The most correctness-sensitive module in Phase 1. The backend treats two parallel refreshes with the same token as **token theft and revokes the whole family** (`auth.service.ts` `claimForRotation`), so concurrent 401s must collapse to exactly one refresh.

**Files:**
- Create: `client/lib/api/client.ts`, `client/lib/api/client.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `parseErrorEnvelope` from Task 2
- Produces:
  - `createApiClient(config: ApiClientConfig): ApiClient`
  - `interface ApiClient { request<T>(path, init?): Promise<T>; get<T>; post<T>; patch<T>; put<T>; del<T> }`
  - `interface ApiClientConfig { baseUrl: string; getAccessToken(): string | null; getRefreshToken(): string | null; onTokens(pair: {accessToken,refreshToken,expiresIn}): void; onAuthFailure(): void; fetchImpl?: typeof fetch }`

- [x] **Step 1: Write the failing test**

`client/lib/api/client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"
import { createApiClient } from "./client"

function envelope(code: string, status: number) {
  return {
    error: { code, message: code, statusCode: status, details: null, correlationId: "c", timestamp: "t", path: "/p" },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

interface Harness {
  fetchImpl: ReturnType<typeof vi.fn>
  onTokens: ReturnType<typeof vi.fn>
  onAuthFailure: ReturnType<typeof vi.fn>
  client: ReturnType<typeof createApiClient>
}

function harness(overrides: { access?: string | null; refresh?: string | null } = {}): Harness {
  let access = overrides.access === undefined ? "access-1" : overrides.access
  const refresh = overrides.refresh === undefined ? "refresh-1" : overrides.refresh
  const fetchImpl = vi.fn()
  const onTokens = vi.fn((p: { accessToken: string }) => { access = p.accessToken })
  const onAuthFailure = vi.fn()
  const client = createApiClient({
    baseUrl: "https://api.test",
    getAccessToken: () => access,
    getRefreshToken: () => refresh,
    onTokens,
    onAuthFailure,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  })
  return { fetchImpl, onTokens, onAuthFailure, client }
}

describe("createApiClient", () => {
  beforeEach(() => vi.clearAllMocks())

  it("prefixes the base URL and attaches the bearer token", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await h.client.get("/auth/me")
    const [url, init] = h.fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.test/auth/me")
    expect((init.headers as Headers).get("authorization")).toBe("Bearer access-1")
  })

  it("never sends credentials", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({}))
    await h.client.get("/auth/me")
    expect(h.fetchImpl.mock.calls[0][1].credentials).toBe("omit")
  })

  it("omits the bearer header when there is no access token", async () => {
    const h = harness({ access: null })
    h.fetchImpl.mockResolvedValueOnce(jsonResponse({}))
    await h.client.post("/auth/login", { email: "a@b.c", password: "x" })
    expect((h.fetchImpl.mock.calls[0][1].headers as Headers).has("authorization")).toBe(false)
  })

  it("throws a typed ApiError on a non-2xx", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse(envelope("VALIDATION_FAILED", 422), 422))
    await expect(h.client.get("/x")).rejects.toBeInstanceOf(ApiError)
  })

  it("returns null for 204", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(h.client.del("/files/1")).resolves.toBeNull()
  })

  it("refreshes once on an expired token and retries the request", async () => {
    const h = harness()
    h.fetchImpl
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 }))
      .mockResolvedValueOnce(jsonResponse({ id: "u1" }))

    await expect(h.client.get("/auth/me")).resolves.toEqual({ id: "u1" })

    expect(h.fetchImpl).toHaveBeenCalledTimes(3)
    expect(h.fetchImpl.mock.calls[1][0]).toBe("https://api.test/auth/refresh")
    expect(h.onTokens).toHaveBeenCalledWith({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 })
    // the retry carries the NEW token
    expect((h.fetchImpl.mock.calls[2][1].headers as Headers).get("authorization")).toBe("Bearer access-2")
  })

  it("collapses five concurrent 401s into exactly one refresh", async () => {
    const h = harness()
    h.fetchImpl.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith("/auth/refresh")) {
        return Promise.resolve(jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 }))
      }
      const auth = (init.headers as Headers).get("authorization")
      if (auth === "Bearer access-1") {
        return Promise.resolve(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      }
      return Promise.resolve(jsonResponse({ ok: true }))
    })

    const results = await Promise.all([
      h.client.get("/a"), h.client.get("/b"), h.client.get("/c"),
      h.client.get("/d"), h.client.get("/e"),
    ])

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }])
    const refreshCalls = h.fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith("/auth/refresh"))
    expect(refreshCalls).toHaveLength(1)
  })

  it("retries only once — a second 401 after refresh fails the request", async () => {
    const h = harness()
    h.fetchImpl
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2", expiresIn: 900 }))
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))

    await expect(h.client.get("/auth/me")).rejects.toBeInstanceOf(ApiError)
    expect(h.fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("calls onAuthFailure and throws when the refresh itself fails", async () => {
    const h = harness()
    h.fetchImpl
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
      .mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_REUSE", 401), 401))

    await expect(h.client.get("/auth/me")).rejects.toBeInstanceOf(ApiError)
    expect(h.onAuthFailure).toHaveBeenCalledTimes(1)
  })

  it("does not attempt a refresh when there is no refresh token", async () => {
    const h = harness({ refresh: null })
    h.fetchImpl.mockResolvedValueOnce(jsonResponse(envelope("AUTH_TOKEN_EXPIRED", 401), 401))
    await expect(h.client.get("/auth/me")).rejects.toBeInstanceOf(ApiError)
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
    expect(h.onAuthFailure).toHaveBeenCalledTimes(1)
  })

  it("does not refresh on a 401 that is not an expiry", async () => {
    const h = harness()
    h.fetchImpl.mockResolvedValueOnce(jsonResponse(envelope("AUTH_INVALID_CREDENTIALS", 401), 401))
    await expect(h.client.post("/auth/login", {})).rejects.toBeInstanceOf(ApiError)
    expect(h.fetchImpl).toHaveBeenCalledTimes(1)
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test lib/api/client
```

Expected: FAIL — `Failed to resolve import "./client"`.

- [x] **Step 3: Implement**

`client/lib/api/client.ts`:

```ts
import { ApiError, parseErrorEnvelope } from "./errors"

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface ApiClientConfig {
  baseUrl: string
  getAccessToken: () => string | null
  getRefreshToken: () => string | null
  onTokens: (pair: TokenPair) => void
  onAuthFailure: () => void
  fetchImpl?: typeof fetch
}

export interface ApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>
  get<T>(path: string, init?: RequestInit): Promise<T>
  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>
  del<T>(path: string, init?: RequestInit): Promise<T>
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.headers.get("content-length") === "0") return null
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetchImpl ?? globalThis.fetch

  // The single-flight latch. While a refresh is in progress every other 401
  // awaits THIS promise instead of starting its own. The backend rotates
  // refresh tokens with a compare-and-set and treats a second concurrent use
  // as theft — it revokes the whole family — so this is correctness.
  let inFlightRefresh: Promise<boolean> | null = null

  async function performRefresh(): Promise<boolean> {
    const refreshToken = config.getRefreshToken()
    if (!refreshToken) {
      config.onAuthFailure()
      return false
    }
    const res = await doFetch(`${config.baseUrl}/auth/refresh`, {
      method: "POST",
      credentials: "omit",
      headers: new Headers({ "content-type": "application/json" }),
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) {
      config.onAuthFailure()
      return false
    }
    const pair = (await readBody(res)) as TokenPair | null
    if (!pair?.accessToken) {
      config.onAuthFailure()
      return false
    }
    config.onTokens(pair)
    return true
  }

  function refreshOnce(): Promise<boolean> {
    if (!inFlightRefresh) {
      inFlightRefresh = performRefresh().finally(() => {
        inFlightRefresh = null
      })
    }
    return inFlightRefresh
  }

  async function send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    const token = config.getAccessToken()
    if (token) headers.set("authorization", `Bearer ${token}`)
    return doFetch(`${config.baseUrl}${path}`, { ...init, headers, credentials: "omit" })
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res = await send(path, init)

    if (res.status === 401) {
      const body = await readBody(res)
      const err = parseErrorEnvelope(401, body)
      if (!err.isAuthExpiry()) throw err

      const refreshed = await refreshOnce()
      if (!refreshed) throw err

      // Exactly one retry. A second 401 means the fresh token is also being
      // rejected — retrying again would loop.
      res = await send(path, init)
      if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res))
      return (await readBody(res)) as T
    }

    if (!res.ok) throw parseErrorEnvelope(res.status, await readBody(res))
    return (await readBody(res)) as T
  }

  function withBody(method: string) {
    return <T>(path: string, body?: unknown, init: RequestInit = {}) =>
      request<T>(path, {
        ...init,
        method,
        headers: new Headers({ "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) }),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
  }

  return {
    request,
    get: <T,>(path: string, init: RequestInit = {}) => request<T>(path, { ...init, method: "GET" }),
    post: withBody("POST"),
    patch: withBody("PATCH"),
    put: withBody("PUT"),
    del: <T,>(path: string, init: RequestInit = {}) => request<T>(path, { ...init, method: "DELETE" }),
  }
}
```

- [x] **Step 4: Run it and watch it pass**

```bash
pnpm --dir client test lib/api/client
```

Expected: PASS, 11 tests. **The concurrency test is the one that matters** — if it reports more than one refresh call, the latch is wrong and the backend would revoke the token family in production.

- [x] **Step 5: Commit**

```bash
git add client/lib/api/client.ts client/lib/api/client.test.ts
git commit -m "feat(client): add API client with single-flight token refresh

Concurrent 401s collapse to one /auth/refresh call. The backend rotates
refresh tokens with compare-and-set and treats a second concurrent use as
theft, revoking the family — so serialising refresh is correctness.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Auth types and endpoint wrappers

**Files:**
- Create: `client/lib/api/types.ts`, `client/lib/api/endpoints/auth.ts`, `client/lib/api/endpoints/auth.test.ts`

**Interfaces:**
- Consumes: `ApiClient` from Task 3
- Produces:
  - `interface UserProfile { id: string | null; kind: "user"|"service"|"system"; role?: "user"|"admin"|"agent"; email?: string; displayName?: string | null }`
  - `interface Paginated<T> { data: T[]; total: number; page: number; limit: number }`
  - `createAuthApi(client: ApiClient)` → `{ login, refresh, logout, logoutAll, me, sessions, forgotPassword, resetPassword, changePassword }`

- [x] **Step 1: Write the failing test**

`client/lib/api/endpoints/auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createAuthApi } from "./auth"
import type { ApiClient } from "../client"

function stubClient() {
  return {
    request: vi.fn(), get: vi.fn(), post: vi.fn(),
    patch: vi.fn(), put: vi.fn(), del: vi.fn(),
  } as unknown as ApiClient & Record<string, ReturnType<typeof vi.fn>>
}

describe("createAuthApi", () => {
  it("posts credentials to /auth/login", async () => {
    const c = stubClient()
    c.post.mockResolvedValue({ accessToken: "a", refreshToken: "r", expiresIn: 900 })
    const api = createAuthApi(c)
    await api.login({ email: "a@b.c", password: "pw" })
    expect(c.post).toHaveBeenCalledWith("/auth/login", { email: "a@b.c", password: "pw" })
  })

  it("gets the principal from /auth/me", async () => {
    const c = stubClient()
    c.get.mockResolvedValue({ id: "u1", kind: "user", role: "admin", email: "a@b.c" })
    const api = createAuthApi(c)
    await expect(api.me()).resolves.toMatchObject({ kind: "user", role: "admin" })
    expect(c.get).toHaveBeenCalledWith("/auth/me")
  })

  it("sends the refresh token in the logout body", async () => {
    const c = stubClient()
    c.post.mockResolvedValue(null)
    await createAuthApi(c).logout("r-1")
    expect(c.post).toHaveBeenCalledWith("/auth/logout", { refreshToken: "r-1" })
  })

  it("posts to /auth/forgot-password", async () => {
    const c = stubClient()
    c.post.mockResolvedValue(null)
    await createAuthApi(c).forgotPassword("a@b.c")
    expect(c.post).toHaveBeenCalledWith("/auth/forgot-password", { email: "a@b.c" })
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test lib/api/endpoints/auth
```

Expected: FAIL — module not found.

- [x] **Step 3: Write the shared types**

`client/lib/api/types.ts`:

```ts
/** Mirrors `api/src/features/auth/auth.types.ts`. */
export type PrincipalKind = "user" | "service" | "system"
export type UserRole = "user" | "admin" | "agent"

export interface UserProfile {
  id: string | null
  kind: PrincipalKind
  role?: UserRole
  email?: string
  displayName?: string | null
}

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** The list envelope every paginated endpoint returns. */
export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  limit: number
}
```

- [x] **Step 4: Write the endpoint module**

`client/lib/api/endpoints/auth.ts`:

```ts
import type { ApiClient } from "../client"
import type { TokenPair, UserProfile } from "../types"

export interface SessionRow {
  id: string
  userAgent?: string | null
  ip?: string | null
  createdAt: string
  expiresAt: string
}

/** Wrappers over `api/src/features/auth/auth.controller.ts`. */
export function createAuthApi(client: ApiClient) {
  return {
    login: (body: { email: string; password: string }) =>
      client.post<TokenPair>("/auth/login", body),

    refresh: (refreshToken: string) =>
      client.post<TokenPair>("/auth/refresh", { refreshToken }),

    logout: (refreshToken: string) =>
      client.post<null>("/auth/logout", { refreshToken }),

    logoutAll: () => client.post<null>("/auth/logout-all"),

    me: () => client.get<UserProfile>("/auth/me"),

    sessions: () => client.get<SessionRow[]>("/auth/sessions"),

    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      client.patch<null>("/auth/password", body),

    forgotPassword: (email: string) =>
      client.post<null>("/auth/forgot-password", { email }),

    resetPassword: (body: { email: string; code: string; newPassword: string }) =>
      client.post<null>("/auth/reset-password", body),
  }
}

export type AuthApi = ReturnType<typeof createAuthApi>
```

- [x] **Step 5: Run it and watch it pass**

```bash
pnpm --dir client test lib/api/endpoints/auth
```

Expected: PASS, 4 tests.

- [x] **Step 6: Verify the reset-password body against the backend DTO**

```bash
cat api/src/features/auth/dto/reset-password.dto.ts
```

If the field names differ from `{ email, code, newPassword }`, correct `resetPassword` to match and re-run the test. Do not guess.

- [x] **Step 7: Commit**

```bash
git add client/lib/api/types.ts client/lib/api/endpoints
git commit -m "feat(client): add auth endpoint wrappers and shared API types

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Auth store

**Files:**
- Create: `client/stores/auth.store.ts`, `client/stores/auth.store.test.ts`
- Modify: `client/package.json` (add `zustand`)

**Interfaces:**
- Consumes: `UserProfile`, `TokenPair` from Task 4
- Produces:
  - `useAuthStore` with state `{ principal, accessToken, refreshToken, status, error }`
  - actions `setTokens(pair)`, `setPrincipal(p)`, `clear()`, `setStatus(s)`, `setError(e)`
  - selectors `selectIsAuthenticated`
  - `REFRESH_STORAGE_KEY` — the only persisted value

- [x] **Step 1: Install zustand**

```bash
pnpm --dir client add zustand
```

- [x] **Step 2: Write the failing test**

`client/stores/auth.store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import { REFRESH_STORAGE_KEY, selectIsAuthenticated, useAuthStore } from "./auth.store"

describe("auth.store", () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.getState().clear()
  })

  it("starts unauthenticated and idle", () => {
    const s = useAuthStore.getState()
    expect(s.principal).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.status).toBe("idle")
    expect(selectIsAuthenticated(s)).toBe(false)
  })

  it("stores the access token in memory and persists ONLY the refresh token", () => {
    useAuthStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    expect(useAuthStore.getState().accessToken).toBe("a-1")
    expect(localStorage.getItem(REFRESH_STORAGE_KEY)).toBe("r-1")
    // the access token must never reach storage
    expect(JSON.stringify(localStorage)).not.toContain("a-1")
  })

  it("is authenticated once a principal and access token are present", () => {
    useAuthStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    useAuthStore.getState().setPrincipal({ id: "u1", kind: "user", role: "user" })
    expect(selectIsAuthenticated(useAuthStore.getState())).toBe(true)
    expect(useAuthStore.getState().status).toBe("ready")
  })

  it("clear() wipes memory and storage", () => {
    useAuthStore.getState().setTokens({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 })
    useAuthStore.getState().setPrincipal({ id: "u1", kind: "user" })
    useAuthStore.getState().clear()
    const s = useAuthStore.getState()
    expect(s.principal).toBeNull()
    expect(s.accessToken).toBeNull()
    expect(s.refreshToken).toBeNull()
    expect(s.status).toBe("idle")
    expect(localStorage.getItem(REFRESH_STORAGE_KEY)).toBeNull()
  })

  it("rehydrates the refresh token from storage", () => {
    localStorage.setItem(REFRESH_STORAGE_KEY, "r-persisted")
    expect(useAuthStore.getState().readPersistedRefresh()).toBe("r-persisted")
  })

  it("records an error and moves to the error status", () => {
    useAuthStore.getState().setError("Invalid credentials")
    const s = useAuthStore.getState()
    expect(s.status).toBe("error")
    expect(s.error).toBe("Invalid credentials")
  })

  it("setStatus('loading') clears any previous error", () => {
    useAuthStore.getState().setError("boom")
    useAuthStore.getState().setStatus("loading")
    expect(useAuthStore.getState().error).toBeNull()
  })
})
```

- [x] **Step 3: Run it and watch it fail**

```bash
pnpm --dir client test stores/auth.store
```

Expected: FAIL — module not found.

- [x] **Step 4: Implement**

`client/stores/auth.store.ts`:

```ts
import { create } from "zustand"
import type { TokenPair, UserProfile } from "@/lib/api/types"

/**
 * The ONLY persisted auth value. The access token stays in memory: with
 * `credentials: false` on the API there is no cookie transport, so the refresh
 * token has to survive a reload somehow — but the access token is the
 * credential an XSS would want, and it never touches storage.
 */
export const REFRESH_STORAGE_KEY = "cyb.refresh"

export type AuthStatus = "idle" | "loading" | "ready" | "error"

interface AuthState {
  principal: UserProfile | null
  accessToken: string | null
  refreshToken: string | null
  status: AuthStatus
  error: string | null

  setTokens: (pair: TokenPair) => void
  setPrincipal: (p: UserProfile) => void
  setStatus: (s: AuthStatus) => void
  setError: (message: string) => void
  clear: () => void
  readPersistedRefresh: () => string | null
}

function persistRefresh(token: string | null): void {
  if (typeof window === "undefined") return
  if (token) localStorage.setItem(REFRESH_STORAGE_KEY, token)
  else localStorage.removeItem(REFRESH_STORAGE_KEY)
}

export const useAuthStore = create<AuthState>((set) => ({
  principal: null,
  accessToken: null,
  refreshToken: null,
  status: "idle",
  error: null,

  setTokens: (pair) => {
    persistRefresh(pair.refreshToken)
    set({ accessToken: pair.accessToken, refreshToken: pair.refreshToken, error: null })
  },

  setPrincipal: (principal) => set({ principal, status: "ready", error: null }),

  setStatus: (status) => set({ status, error: status === "loading" ? null : undefined }),

  setError: (error) => set({ status: "error", error }),

  clear: () => {
    persistRefresh(null)
    set({ principal: null, accessToken: null, refreshToken: null, status: "idle", error: null })
  },

  readPersistedRefresh: () =>
    typeof window === "undefined" ? null : localStorage.getItem(REFRESH_STORAGE_KEY),
}))

export const selectIsAuthenticated = (s: AuthState): boolean =>
  s.principal !== null && s.accessToken !== null
```

- [x] **Step 5: Run it and watch it pass**

```bash
pnpm --dir client test stores/auth.store
```

Expected: PASS, 7 tests.

- [x] **Step 6: Commit**

```bash
git add client/stores/auth.store.ts client/stores/auth.store.test.ts client/package.json client/pnpm-lock.yaml
git commit -m "feat(client): add auth store with in-memory access token

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Window geometry (pure functions)

Cascade and clamp maths, extracted so the store's tests do not need a viewport.

**Files:**
- Create: `client/lib/windows/types.ts`, `client/lib/windows/geometry.ts`, `client/lib/windows/geometry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type WindowKind`, `interface Rect { x, y, w, h }`, `interface WindowInstance`, `interface WindowDescriptor`
  - `cascade(index: number, base: Rect, viewport: {w,h}): Rect`
  - `clampToViewport(rect: Rect, viewport: {w,h}): Rect`

- [x] **Step 1: Write the failing test**

`client/lib/windows/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { CASCADE_STEP, cascade, clampToViewport } from "./geometry"

const VIEWPORT = { w: 1400, h: 900 }
const BASE = { x: 80, y: 80, w: 900, h: 600 }

describe("cascade", () => {
  it("returns the base rect for the first window", () => {
    expect(cascade(0, BASE, VIEWPORT)).toEqual(BASE)
  })

  it("offsets each subsequent window", () => {
    const second = cascade(1, BASE, VIEWPORT)
    expect(second.x).toBe(BASE.x + CASCADE_STEP)
    expect(second.y).toBe(BASE.y + CASCADE_STEP)
  })

  it("wraps rather than marching off-screen", () => {
    const far = cascade(50, BASE, VIEWPORT)
    expect(far.x + far.w).toBeLessThanOrEqual(VIEWPORT.w)
    expect(far.y + far.h).toBeLessThanOrEqual(VIEWPORT.h)
  })
})

describe("clampToViewport", () => {
  it("leaves a fitting rect alone", () => {
    expect(clampToViewport(BASE, VIEWPORT)).toEqual(BASE)
  })

  it("pulls a rect back inside the right/bottom edges", () => {
    const r = clampToViewport({ x: 1350, y: 880, w: 900, h: 600 }, VIEWPORT)
    expect(r.x + r.w).toBeLessThanOrEqual(VIEWPORT.w)
    expect(r.y + r.h).toBeLessThanOrEqual(VIEWPORT.h)
  })

  it("never produces negative coordinates", () => {
    const r = clampToViewport({ x: -400, y: -400, w: 300, h: 200 }, VIEWPORT)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
  })

  it("shrinks a window larger than the viewport", () => {
    const r = clampToViewport({ x: 0, y: 0, w: 3000, h: 2000 }, VIEWPORT)
    expect(r.w).toBeLessThanOrEqual(VIEWPORT.w)
    expect(r.h).toBeLessThanOrEqual(VIEWPORT.h)
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test lib/windows/geometry
```

Expected: FAIL — module not found.

- [x] **Step 3: Write the types**

`client/lib/windows/types.ts`:

```ts
import type { ComponentType, LazyExoticComponent } from "react"
import type { LucideIcon } from "lucide-react"

export type WindowKind =
  | "auth" | "terminal" | "voice" | "settings" | "notifications" | "profile"
  | "files" | "contacts" | "knowledge" | "projects" | "tasks" | "mailbox"
  | "finance" | "invoices" | "tags" | "activity" | "search"
  | "record-create" | "record-edit" | "record-detail" | "confirm"

export interface Rect { x: number; y: number; w: number; h: number }

export type WindowState = "normal" | "minimised" | "maximised"

export interface WindowInstance {
  id: string
  kind: WindowKind
  title: string
  props?: Record<string, unknown>
  rect: Rect
  zIndex: number
  state: WindowState
  modal: boolean
}

export interface WindowDescriptor {
  kind: WindowKind
  title: string
  icon: LucideIcon
  /** Focus-if-open instead of spawning a duplicate. */
  singleton: boolean
  modal?: boolean
  defaultRect?: Partial<Rect>
  minSize?: { w: number; h: number }
  component: LazyExoticComponent<ComponentType<Record<string, unknown>>>
}
```

- [x] **Step 4: Write the geometry**

`client/lib/windows/geometry.ts`:

```ts
import type { Rect } from "./types"

export const CASCADE_STEP = 24
const CASCADE_WRAP = 8
const MARGIN = 16

export interface Viewport { w: number; h: number }

/** Offsets each new window so it does not land exactly on its predecessor. */
export function cascade(index: number, base: Rect, viewport: Viewport): Rect {
  const step = (index % CASCADE_WRAP) * CASCADE_STEP
  return clampToViewport({ ...base, x: base.x + step, y: base.y + step }, viewport)
}

/** Keeps a rect fully on screen, shrinking it first if it cannot fit. */
export function clampToViewport(rect: Rect, viewport: Viewport): Rect {
  const w = Math.min(rect.w, viewport.w - MARGIN * 2)
  const h = Math.min(rect.h, viewport.h - MARGIN * 2)
  const x = Math.max(0, Math.min(rect.x, viewport.w - w))
  const y = Math.max(0, Math.min(rect.y, viewport.h - h))
  return { x, y, w, h }
}
```

- [x] **Step 5: Run it and watch it pass**

```bash
pnpm --dir client test lib/windows/geometry
```

Expected: PASS, 7 tests.

- [x] **Step 6: Commit**

```bash
git add client/lib/windows
git commit -m "feat(client): add window types and cascade/clamp geometry

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Window store

**Files:**
- Create: `client/stores/window.store.ts`, `client/stores/window.store.test.ts`

**Interfaces:**
- Consumes: `WindowKind`, `WindowInstance`, `Rect` from Task 6
- Produces:
  - `useWindowStore` with `{ windows: WindowInstance[], zSeq: number }`
  - `openWindow({kind, title?, props?, modal?, singletonKey?}) → string` (returns the instance id)
  - `closeWindow(id)`, `focusWindow(id)`, `minimiseWindow(id)`, `restoreWindow(id)`, `toggleMaximise(id)`, `moveWindow(id, rect)`, `closeAll()`
  - `selectOpenWindows`, `selectMinimised`, `selectTopModal`
  - `WINDOW_STORAGE_KEY`, `serialiseForPersist(windows)`

- [x] **Step 1: Write the failing test**

`client/stores/window.store.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"
import {
  selectMinimised, selectOpenWindows, selectTopModal,
  serialiseForPersist, useWindowStore,
} from "./window.store"

describe("window.store", () => {
  beforeEach(() => {
    localStorage.clear()
    useWindowStore.getState().closeAll()
  })

  it("opens a window and returns its id", () => {
    const id = useWindowStore.getState().openWindow({ kind: "terminal" })
    expect(id).toBeTruthy()
    expect(useWindowStore.getState().windows).toHaveLength(1)
    expect(useWindowStore.getState().windows[0].kind).toBe("terminal")
  })

  it("focuses an existing singleton instead of duplicating it", () => {
    const s = useWindowStore.getState()
    const first = s.openWindow({ kind: "terminal" })
    useWindowStore.getState().openWindow({ kind: "contacts" })
    const again = useWindowStore.getState().openWindow({ kind: "terminal" })

    expect(again).toBe(first)
    expect(useWindowStore.getState().windows).toHaveLength(2)
    // re-opening brings it to the front
    const top = [...useWindowStore.getState().windows].sort((a, b) => b.zIndex - a.zIndex)[0]
    expect(top.id).toBe(first)
  })

  it("re-opening a minimised singleton restores it", () => {
    const id = useWindowStore.getState().openWindow({ kind: "terminal" })
    useWindowStore.getState().minimiseWindow(id)
    expect(useWindowStore.getState().windows[0].state).toBe("minimised")
    useWindowStore.getState().openWindow({ kind: "terminal" })
    expect(useWindowStore.getState().windows[0].state).toBe("normal")
  })

  it("keys non-singletons so the same record opens once but two records coexist", () => {
    const s = useWindowStore.getState()
    const a1 = s.openWindow({ kind: "record-detail", singletonKey: "contacts:1", props: { id: "1" } })
    const a2 = useWindowStore.getState().openWindow({ kind: "record-detail", singletonKey: "contacts:1", props: { id: "1" } })
    const b = useWindowStore.getState().openWindow({ kind: "record-detail", singletonKey: "contacts:2", props: { id: "2" } })

    expect(a2).toBe(a1)
    expect(b).not.toBe(a1)
    expect(useWindowStore.getState().windows).toHaveLength(2)
  })

  it("assigns an increasing zIndex and focus raises to the top", () => {
    const s = useWindowStore.getState()
    const a = s.openWindow({ kind: "terminal" })
    const b = useWindowStore.getState().openWindow({ kind: "contacts" })
    expect(useWindowStore.getState().windows.find((w) => w.id === b)!.zIndex)
      .toBeGreaterThan(useWindowStore.getState().windows.find((w) => w.id === a)!.zIndex)

    useWindowStore.getState().focusWindow(a)
    expect(useWindowStore.getState().windows.find((w) => w.id === a)!.zIndex)
      .toBeGreaterThan(useWindowStore.getState().windows.find((w) => w.id === b)!.zIndex)
  })

  it("keeps modal windows above every non-modal window", () => {
    const s = useWindowStore.getState()
    s.openWindow({ kind: "terminal" })
    const auth = useWindowStore.getState().openWindow({ kind: "auth", modal: true })
    const late = useWindowStore.getState().openWindow({ kind: "contacts" })

    const state = useWindowStore.getState()
    const modalZ = state.windows.find((w) => w.id === auth)!.zIndex
    const lateZ = state.windows.find((w) => w.id === late)!.zIndex
    expect(modalZ).toBeGreaterThan(lateZ)
    expect(selectTopModal(state)?.id).toBe(auth)
  })

  it("cascades so two windows do not sit exactly on top of each other", () => {
    const s = useWindowStore.getState()
    s.openWindow({ kind: "terminal" })
    useWindowStore.getState().openWindow({ kind: "contacts" })
    const [a, b] = useWindowStore.getState().windows
    expect({ x: b.rect.x, y: b.rect.y }).not.toEqual({ x: a.rect.x, y: a.rect.y })
  })

  it("closes a window", () => {
    const id = useWindowStore.getState().openWindow({ kind: "terminal" })
    useWindowStore.getState().closeWindow(id)
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })

  it("toggles maximise and back to normal", () => {
    const id = useWindowStore.getState().openWindow({ kind: "terminal" })
    useWindowStore.getState().toggleMaximise(id)
    expect(useWindowStore.getState().windows[0].state).toBe("maximised")
    useWindowStore.getState().toggleMaximise(id)
    expect(useWindowStore.getState().windows[0].state).toBe("normal")
  })

  it("moveWindow records a new rect", () => {
    const id = useWindowStore.getState().openWindow({ kind: "terminal" })
    useWindowStore.getState().moveWindow(id, { x: 10, y: 20, w: 400, h: 300 })
    expect(useWindowStore.getState().windows[0].rect).toEqual({ x: 10, y: 20, w: 400, h: 300 })
  })

  it("selectors split normal from minimised", () => {
    const s = useWindowStore.getState()
    const a = s.openWindow({ kind: "terminal" })
    useWindowStore.getState().openWindow({ kind: "contacts" })
    useWindowStore.getState().minimiseWindow(a)

    const state = useWindowStore.getState()
    expect(selectOpenWindows(state).map((w) => w.kind)).toEqual(["contacts"])
    expect(selectMinimised(state).map((w) => w.kind)).toEqual(["terminal"])
  })

  it("excludes modal and record-* windows from persistence", () => {
    const s = useWindowStore.getState()
    s.openWindow({ kind: "terminal" })
    useWindowStore.getState().openWindow({ kind: "auth", modal: true })
    useWindowStore.getState().openWindow({ kind: "record-edit", singletonKey: "contacts:1" })

    const persisted = serialiseForPersist(useWindowStore.getState().windows)
    expect(persisted.map((w) => w.kind)).toEqual(["terminal"])
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test stores/window.store
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement**

`client/stores/window.store.ts`:

```ts
import { nanoid } from "nanoid"
import { create } from "zustand"
import { cascade, clampToViewport, type Viewport } from "@/lib/windows/geometry"
import type { Rect, WindowInstance, WindowKind } from "@/lib/windows/types"

export const WINDOW_STORAGE_KEY = "cyb.windows"

/** Modal windows live in their own, always-higher band. */
const MODAL_Z_BASE = 10_000

const DEFAULT_RECT: Rect = { x: 80, y: 80, w: 900, h: 600 }

/** Kinds whose contents are transient — restoring them after a reload would
 *  resurrect a half-filled form or a dialog the user already dismissed. */
const NEVER_PERSIST: ReadonlySet<WindowKind> = new Set([
  "auth", "confirm", "record-create", "record-edit", "record-detail",
])

export interface OpenWindowInput {
  kind: WindowKind
  title?: string
  props?: Record<string, unknown>
  modal?: boolean
  /** Identity for de-duplication. Defaults to `kind`, which makes it a singleton. */
  singletonKey?: string
  rect?: Partial<Rect>
}

interface WindowStoreState {
  windows: WindowInstance[]
  zSeq: number
  viewport: Viewport

  setViewport: (v: Viewport) => void
  openWindow: (input: OpenWindowInput) => string
  closeWindow: (id: string) => void
  focusWindow: (id: string) => void
  minimiseWindow: (id: string) => void
  restoreWindow: (id: string) => void
  toggleMaximise: (id: string) => void
  moveWindow: (id: string, rect: Rect) => void
  closeAll: () => void
  hydrate: (windows: WindowInstance[]) => void
}

/** The de-duplication identity for an instance. */
function keyOf(w: WindowInstance): string {
  return (w.props?.__key as string | undefined) ?? w.kind
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  windows: [],
  zSeq: 0,
  viewport: { w: 1440, h: 900 },

  setViewport: (viewport) => set({ viewport }),

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
    const { windows, zSeq, viewport } = get()
    const nextZ = zSeq + 1

    const base = clampToViewport({ ...DEFAULT_RECT, ...input.rect }, viewport)
    const rect = input.rect?.x != null
      ? base
      : cascade(windows.length, base, viewport)

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

    set({ windows: [...windows, instance], zSeq: nextZ })
    return id
  },

  closeWindow: (id) =>
    set((s) => ({ windows: s.windows.filter((w) => w.id !== id) })),

  focusWindow: (id) =>
    set((s) => {
      const target = s.windows.find((w) => w.id === id)
      if (!target) return s
      const nextZ = s.zSeq + 1
      return {
        zSeq: nextZ,
        windows: s.windows.map((w) =>
          w.id === id
            ? { ...w, zIndex: w.modal ? MODAL_Z_BASE + nextZ : nextZ }
            : w,
        ),
      }
    }),

  minimiseWindow: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, state: "minimised" } : w)),
    })),

  restoreWindow: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, state: "normal" } : w)),
    })),

  toggleMaximise: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id
          ? { ...w, state: w.state === "maximised" ? "normal" : "maximised" }
          : w,
      ),
    })),

  moveWindow: (id, rect) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, rect: clampToViewport(rect, s.viewport) } : w,
      ),
    })),

  closeAll: () => set({ windows: [], zSeq: 0 }),

  hydrate: (windows) =>
    set({ windows, zSeq: windows.reduce((m, w) => Math.max(m, w.zIndex), 0) }),
}))

export const selectOpenWindows = (s: WindowStoreState): WindowInstance[] =>
  s.windows.filter((w) => w.state !== "minimised").sort((a, b) => a.zIndex - b.zIndex)

export const selectMinimised = (s: WindowStoreState): WindowInstance[] =>
  s.windows.filter((w) => w.state === "minimised")

export const selectTopModal = (s: WindowStoreState): WindowInstance | null =>
  s.windows.filter((w) => w.modal).sort((a, b) => b.zIndex - a.zIndex)[0] ?? null

/** What survives a reload: the user's workspace, never their in-flight work. */
export function serialiseForPersist(windows: WindowInstance[]): WindowInstance[] {
  return windows.filter((w) => !w.modal && !NEVER_PERSIST.has(w.kind))
}
```

- [x] **Step 4: Run it and watch it pass**

```bash
pnpm --dir client test stores/window.store
```

Expected: PASS, 12 tests.

- [x] **Step 5: Run the whole suite to check nothing regressed**

```bash
pnpm --dir client test && pnpm --dir client typecheck
```

Expected: all green.

- [x] **Step 6: Commit**

```bash
git add client/stores/window.store.ts client/stores/window.store.test.ts
git commit -m "feat(client): add window store with singleton, z-order and modal banding

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Drag and resize hook

**Files:**
- Create: `client/components/windows/use-drag-resize.ts`, `client/components/windows/use-drag-resize.test.ts`

**Interfaces:**
- Consumes: `Rect` from Task 6
- Produces:
  - `useDragResize({rect, minSize, onCommit, disabled}) → { dragProps, resizeProps, liveRect, isInteracting }`
  - `dragProps` / `resizeProps(handle)` spread onto elements as `onPointerDown`

- [x] **Step 1: Write the failing test**

`client/components/windows/use-drag-resize.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { applyDrag, applyResize } from "./use-drag-resize"

const RECT = { x: 100, y: 100, w: 600, h: 400 }
const MIN = { w: 320, h: 200 }

describe("applyDrag", () => {
  it("translates the rect by the pointer delta", () => {
    expect(applyDrag(RECT, { dx: 40, dy: -25 })).toEqual({ x: 140, y: 75, w: 600, h: 400 })
  })

  it("leaves the size untouched", () => {
    const r = applyDrag(RECT, { dx: 999, dy: 999 })
    expect(r.w).toBe(600)
    expect(r.h).toBe(400)
  })
})

describe("applyResize", () => {
  it("grows from the south-east handle", () => {
    expect(applyResize(RECT, "se", { dx: 50, dy: 30 }, MIN))
      .toEqual({ x: 100, y: 100, w: 650, h: 430 })
  })

  it("moves the origin when resizing from the north-west handle", () => {
    expect(applyResize(RECT, "nw", { dx: 50, dy: 30 }, MIN))
      .toEqual({ x: 150, y: 130, w: 550, h: 370 })
  })

  it("refuses to shrink below the minimum size", () => {
    const r = applyResize(RECT, "se", { dx: -900, dy: -900 }, MIN)
    expect(r.w).toBe(MIN.w)
    expect(r.h).toBe(MIN.h)
  })

  it("does not let a north-west resize push the origin past the minimum", () => {
    const r = applyResize(RECT, "nw", { dx: 900, dy: 900 }, MIN)
    expect(r.w).toBe(MIN.w)
    expect(r.h).toBe(MIN.h)
    // the right/bottom edges must stay put
    expect(r.x + r.w).toBe(RECT.x + RECT.w)
    expect(r.y + r.h).toBe(RECT.y + RECT.h)
  })

  it("resizes width only from the east handle", () => {
    expect(applyResize(RECT, "e", { dx: 40, dy: 500 }, MIN))
      .toEqual({ x: 100, y: 100, w: 640, h: 400 })
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test components/windows/use-drag-resize
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement**

`client/components/windows/use-drag-resize.ts`:

```ts
"use client"

import { useCallback, useRef, useState } from "react"
import type { Rect } from "@/lib/windows/types"

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

export interface Delta { dx: number; dy: number }
export interface Size { w: number; h: number }

const DEFAULT_MIN: Size = { w: 320, h: 200 }

/** Pure: translate a rect. */
export function applyDrag(rect: Rect, d: Delta): Rect {
  return { ...rect, x: rect.x + d.dx, y: rect.y + d.dy }
}

/**
 * Pure: resize from one handle. North/west handles move the origin as well as
 * the size, and are clamped so the opposite edge never moves.
 */
export function applyResize(rect: Rect, handle: ResizeHandle, d: Delta, min: Size = DEFAULT_MIN): Rect {
  let { x, y, w, h } = rect

  if (handle.includes("e")) w = Math.max(min.w, w + d.dx)
  if (handle.includes("s")) h = Math.max(min.h, h + d.dy)

  if (handle.includes("w")) {
    const right = x + w
    const nextW = Math.max(min.w, w - d.dx)
    x = right - nextW
    w = nextW
  }
  if (handle.includes("n")) {
    const bottom = y + h
    const nextH = Math.max(min.h, h - d.dy)
    y = bottom - nextH
    h = nextH
  }

  return { x, y, w, h }
}

export interface UseDragResize {
  liveRect: Rect
  isInteracting: boolean
  dragProps: { onPointerDown: (e: React.PointerEvent) => void }
  resizeProps: (handle: ResizeHandle) => { onPointerDown: (e: React.PointerEvent) => void }
}

export function useDragResize(opts: {
  rect: Rect
  minSize?: Size
  disabled?: boolean
  onCommit: (rect: Rect) => void
}): UseDragResize {
  const { rect, minSize = DEFAULT_MIN, disabled = false, onCommit } = opts
  const [liveRect, setLiveRect] = useState<Rect | null>(null)
  const origin = useRef<{ x: number; y: number; rect: Rect } | null>(null)

  const begin = useCallback(
    (e: React.PointerEvent, transform: (start: Rect, d: Delta) => Rect) => {
      if (disabled || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      origin.current = { x: e.clientX, y: e.clientY, rect }

      const onMove = (ev: PointerEvent) => {
        const o = origin.current
        if (!o) return
        setLiveRect(transform(o.rect, { dx: ev.clientX - o.x, dy: ev.clientY - o.y }))
      }

      const onUp = (ev: PointerEvent) => {
        const o = origin.current
        if (o) {
          onCommit(transform(o.rect, { dx: ev.clientX - o.x, dy: ev.clientY - o.y }))
        }
        origin.current = null
        setLiveRect(null)
        target.releasePointerCapture?.(ev.pointerId)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
    },
    [disabled, rect, onCommit],
  )

  return {
    liveRect: liveRect ?? rect,
    isInteracting: liveRect !== null,
    dragProps: {
      onPointerDown: (e) => begin(e, (start, d) => applyDrag(start, d)),
    },
    resizeProps: (handle) => ({
      onPointerDown: (e) => begin(e, (start, d) => applyResize(start, handle, d, minSize)),
    }),
  }
}
```

- [x] **Step 4: Run it and watch it pass**

```bash
pnpm --dir client test components/windows/use-drag-resize
```

Expected: PASS, 7 tests.

- [x] **Step 5: Commit**

```bash
git add client/components/windows/use-drag-resize.ts client/components/windows/use-drag-resize.test.ts
git commit -m "feat(client): add window drag/resize hook with pure geometry helpers

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `WindowFrame`

All window chrome in one component, so no feature draws a title bar. Below `md` it renders a full-screen `Sheet` instead of a floating frame; children are identical in both.

**Files:**
- Create: `client/components/windows/window-frame.tsx`, `client/components/windows/window-frame.test.tsx`

**Interfaces:**
- Consumes: `useDragResize` (Task 8), `WindowInstance` (Task 6), `useIsMobile` (`@/hooks/use-mobile`), `Sheet` (`@/components/ui/sheet`)
- Produces: `<WindowFrame window={WindowInstance} onClose onFocus onMinimise onToggleMaximise onMove>{children}</WindowFrame>`

- [x] **Step 1: Write the failing test**

`client/components/windows/window-frame.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WindowInstance } from "@/lib/windows/types"
import { WindowFrame } from "./window-frame"

// vi.mock is hoisted above every `const`/`let`, so the factory cannot close over
// a normal variable — it would throw a ReferenceError at import time. vi.hoisted
// creates the holder in the same hoisted scope.
const mobile = vi.hoisted(() => ({ value: false }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }))

const WIN: WindowInstance = {
  id: "w1", kind: "terminal", title: "Terminal",
  rect: { x: 40, y: 40, w: 600, h: 400 },
  zIndex: 3, state: "normal", modal: false,
}

function setup(overrides: Partial<WindowInstance> = {}) {
  const handlers = {
    onClose: vi.fn(), onFocus: vi.fn(), onMinimise: vi.fn(),
    onToggleMaximise: vi.fn(), onMove: vi.fn(),
  }
  render(
    <WindowFrame window={{ ...WIN, ...overrides }} {...handlers}>
      <p>window body</p>
    </WindowFrame>,
  )
  return handlers
}

describe("WindowFrame", () => {
  beforeEach(() => { mobile.value = false })

  it("renders the title and the children", () => {
    setup()
    expect(screen.getByText("Terminal")).toBeInTheDocument()
    expect(screen.getByText("window body")).toBeInTheDocument()
  })

  it("positions the frame from the rect and zIndex", () => {
    setup()
    const frame = screen.getByRole("dialog", { name: "Terminal" })
    expect(frame).toHaveStyle({ left: "40px", top: "40px", width: "600px", height: "400px", zIndex: "3" })
  })

  it("calls onClose from the close button", async () => {
    const h = setup()
    await userEvent.click(screen.getByRole("button", { name: /close/i }))
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it("calls onMinimise from the minimise button", async () => {
    const h = setup()
    await userEvent.click(screen.getByRole("button", { name: /minimise/i }))
    expect(h.onMinimise).toHaveBeenCalledTimes(1)
  })

  it("calls onToggleMaximise from the maximise button", async () => {
    const h = setup()
    await userEvent.click(screen.getByRole("button", { name: /maximise/i }))
    expect(h.onToggleMaximise).toHaveBeenCalledTimes(1)
  })

  it("focuses on pointer-down anywhere in the frame", async () => {
    const h = setup()
    await userEvent.click(screen.getByText("window body"))
    expect(h.onFocus).toHaveBeenCalled()
  })

  it("Escape closes a non-modal window", async () => {
    const h = setup()
    await userEvent.keyboard("{Escape}")
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it("Escape does NOT close a modal window", async () => {
    const h = setup({ modal: true })
    await userEvent.keyboard("{Escape}")
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it("a maximised window fills the viewport", () => {
    setup({ state: "maximised" })
    const frame = screen.getByRole("dialog", { name: "Terminal" })
    expect(frame).toHaveStyle({ left: "0px", top: "0px" })
  })

  it("renders no resize grips on mobile", () => {
    mobile.value = true
    setup()
    expect(screen.queryByTestId("resize-se")).not.toBeInTheDocument()
  })

  it("renders resize grips on desktop", () => {
    setup()
    expect(screen.getByTestId("resize-se")).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test components/windows/window-frame
```

Expected: FAIL — module not found.

- [x] **Step 3: Implement**

`client/components/windows/window-frame.tsx`:

```tsx
"use client"

import { useEffect, type ReactNode } from "react"
import { MinusIcon, SquareIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { Rect, WindowInstance } from "@/lib/windows/types"
import { useDragResize, type ResizeHandle } from "./use-drag-resize"

export interface WindowFrameProps {
  window: WindowInstance
  onClose: () => void
  onFocus: () => void
  onMinimise: () => void
  onToggleMaximise: () => void
  onMove: (rect: Rect) => void
  children: ReactNode
}

const GRIPS: { handle: ResizeHandle; className: string }[] = [
  { handle: "n",  className: "top-0 inset-x-3 h-1.5 cursor-ns-resize" },
  { handle: "s",  className: "bottom-0 inset-x-3 h-1.5 cursor-ns-resize" },
  { handle: "w",  className: "left-0 inset-y-3 w-1.5 cursor-ew-resize" },
  { handle: "e",  className: "right-0 inset-y-3 w-1.5 cursor-ew-resize" },
  { handle: "nw", className: "top-0 left-0 size-3 cursor-nwse-resize" },
  { handle: "ne", className: "top-0 right-0 size-3 cursor-nesw-resize" },
  { handle: "sw", className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
  { handle: "se", className: "bottom-0 right-0 size-3 cursor-nwse-resize" },
]

export function WindowFrame({
  window: win, onClose, onFocus, onMinimise, onToggleMaximise, onMove, children,
}: WindowFrameProps) {
  const isMobile = useIsMobile()

  const { liveRect, isInteracting, dragProps, resizeProps } = useDragResize({
    rect: win.rect,
    disabled: isMobile || win.state === "maximised",
    onCommit: onMove,
  })

  // Escape closes a non-modal window. Modal windows are dismissed by their own
  // affordances — an auth dialog you can Escape out of is not a gate.
  useEffect(() => {
    if (win.modal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [win.modal, onClose])

  // Below md every window is a full-screen sheet. Children are unchanged, which
  // is what keeps feature components ignorant of the breakpoint.
  if (isMobile) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" className="h-[100dvh] p-0 gap-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-sm font-medium">{win.title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  const rect = win.state === "maximised"
    ? { x: 0, y: 0, w: 0, h: 0 }
    : liveRect

  return (
    <div
      role="dialog"
      aria-label={win.title}
      aria-modal={win.modal || undefined}
      onPointerDown={onFocus}
      style={{
        left: rect.x, top: rect.y, zIndex: win.zIndex,
        ...(win.state === "maximised"
          ? { right: 0, bottom: 0 }
          : { width: rect.w, height: rect.h }),
      }}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-xl border border-border",
        "bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl",
        isInteracting && "select-none",
      )}
    >
      <div
        {...dragProps}
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-border",
          "px-3 py-2",
          win.state === "maximised" ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
      >
        <span className="truncate text-xs font-medium text-muted-foreground">{win.title}</span>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" aria-label="Minimise" onClick={onMinimise} className="size-6">
            <MinusIcon className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Maximise" onClick={onToggleMaximise} className="size-6">
            <SquareIcon className="size-3" />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="size-6">
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {win.state !== "maximised" &&
        GRIPS.map(({ handle, className }) => (
          <div
            key={handle}
            data-testid={`resize-${handle}`}
            {...resizeProps(handle)}
            className={cn("absolute z-10", className)}
          />
        ))}
    </div>
  )
}
```

- [x] **Step 4: Run it and watch it pass**

```bash
pnpm --dir client test components/windows/window-frame
```

Expected: PASS, 11 tests.

- [x] **Step 5: Commit**

```bash
git add client/components/windows/window-frame.tsx client/components/windows/window-frame.test.tsx
git commit -m "feat(client): add WindowFrame chrome with mobile Sheet fallback

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Window registry, layer, and dock

**Files:**
- Create: `client/lib/windows/registry.ts`, `client/components/windows/window-layer.tsx`, `client/components/windows/dock.tsx`, `client/components/windows/window-layer.test.tsx`

**Interfaces:**
- Consumes: `useWindowStore` (Task 7), `WindowFrame` (Task 9), `WindowDescriptor` (Task 6)
- Produces:
  - `WINDOW_REGISTRY: Partial<Record<WindowKind, WindowDescriptor>>`
  - `<WindowLayer />` — renders every non-minimised window
  - `<Dock />` — restores minimised windows

Phase 1 registers only the kinds that exist yet (`auth`, plus a placeholder `terminal` used to prove concurrency). Later phases add entries; nothing else changes.

- [x] **Step 1: Write the failing test**

`client/components/windows/window-layer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWindowStore } from "@/stores/window.store"
import { Dock } from "./dock"
import { WindowLayer } from "./window-layer"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

describe("WindowLayer", () => {
  beforeEach(() => useWindowStore.getState().closeAll())

  it("renders nothing when no windows are open", () => {
    render(<WindowLayer />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("renders two concurrent windows at once", async () => {
    useWindowStore.getState().openWindow({ kind: "terminal", title: "Terminal" })
    useWindowStore.getState().openWindow({ kind: "voice", title: "Live" })
    render(<WindowLayer />)
    expect(await screen.findByRole("dialog", { name: "Terminal" })).toBeInTheDocument()
    expect(await screen.findByRole("dialog", { name: "Live" })).toBeInTheDocument()
  })

  it("does not render a minimised window", async () => {
    const id = useWindowStore.getState().openWindow({ kind: "terminal", title: "Terminal" })
    useWindowStore.getState().minimiseWindow(id)
    render(<WindowLayer />)
    expect(screen.queryByRole("dialog", { name: "Terminal" })).not.toBeInTheDocument()
  })

  it("closing a window removes it from the store", async () => {
    useWindowStore.getState().openWindow({ kind: "terminal", title: "Terminal" })
    render(<WindowLayer />)
    await userEvent.click(await screen.findByRole("button", { name: /close/i }))
    expect(useWindowStore.getState().windows).toHaveLength(0)
  })
})

describe("Dock", () => {
  beforeEach(() => useWindowStore.getState().closeAll())

  it("is hidden when nothing is minimised", () => {
    render(<Dock />)
    expect(screen.queryByRole("toolbar", { name: /minimised/i })).not.toBeInTheDocument()
  })

  it("lists a minimised window and restores it on click", async () => {
    const id = useWindowStore.getState().openWindow({ kind: "terminal", title: "Terminal" })
    useWindowStore.getState().minimiseWindow(id)
    render(<Dock />)

    await userEvent.click(screen.getByRole("button", { name: "Terminal" }))
    expect(useWindowStore.getState().windows[0].state).toBe("normal")
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test components/windows/window-layer
```

Expected: FAIL — modules not found.

- [x] **Step 3: Write the registry**

`client/lib/windows/registry.ts`:

```ts
import { lazy } from "react"
import { LockIcon, MicIcon, TerminalIcon } from "lucide-react"
import type { WindowDescriptor, WindowKind } from "./types"

/**
 * Every window kind that can be opened. Components are lazy so a window's code
 * is fetched the first time it is opened, not at boot.
 *
 * Phase 1 registers only what exists. Later phases add entries here — that is
 * the single place a new feature window is wired in.
 */
export const WINDOW_REGISTRY: Partial<Record<WindowKind, WindowDescriptor>> = {
  auth: {
    kind: "auth",
    title: "Access",
    icon: LockIcon,
    singleton: true,
    modal: true,
    defaultRect: { w: 420, h: 520 },
    component: lazy(() =>
      import("@/components/auth/auth-window").then((m) => ({ default: m.AuthWindow })),
    ),
  },
  terminal: {
    kind: "terminal",
    title: "Terminal",
    icon: TerminalIcon,
    singleton: true,
    defaultRect: { w: 900, h: 600 },
    minSize: { w: 420, h: 320 },
    component: lazy(() =>
      import("@/components/windows/placeholder-window").then((m) => ({ default: m.PlaceholderWindow })),
    ),
  },
  voice: {
    kind: "voice",
    title: "Live",
    icon: MicIcon,
    singleton: true,
    defaultRect: { w: 420, h: 480 },
    component: lazy(() =>
      import("@/components/windows/placeholder-window").then((m) => ({ default: m.PlaceholderWindow })),
    ),
  },
}
```

- [x] **Step 4: Write the placeholder body**

Phase 2/3/5 replace this. It exists so the window manager is provable now.

`client/components/windows/placeholder-window.tsx`:

```tsx
"use client"

export function PlaceholderWindow({ kind }: { kind?: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-center text-sm text-muted-foreground">
        {kind ?? "This window"} is not built yet.
      </p>
    </div>
  )
}
```

- [x] **Step 5: Write the layer**

`client/components/windows/window-layer.tsx`:

```tsx
"use client"

import { Suspense, useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { Spinner } from "@/components/ui/spinner"
import { WINDOW_REGISTRY } from "@/lib/windows/registry"
import { selectOpenWindows, selectTopModal, useWindowStore } from "@/stores/window.store"
import { WindowFrame } from "./window-frame"

export function WindowLayer() {
  // useShallow is required, not stylistic: selectOpenWindows filters and sorts,
  // so it returns a NEW array reference on every call. Under zustand v5 that
  // fails the getSnapshot identity check and re-renders forever.
  const windows = useWindowStore(useShallow(selectOpenWindows))
  const topModal = useWindowStore(selectTopModal)
  const { closeWindow, focusWindow, minimiseWindow, toggleMaximise, moveWindow, setViewport } =
    useWindowStore.getState()

  // The store clamps rects against the viewport, so it has to know its size.
  useEffect(() => {
    const sync = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    sync()
    window.addEventListener("resize", sync)
    return () => window.removeEventListener("resize", sync)
  }, [setViewport])

  if (windows.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {topModal && <div className="pointer-events-auto absolute inset-0 bg-background/60 backdrop-blur-sm" />}
      {windows.map((win) => {
        const descriptor = WINDOW_REGISTRY[win.kind]
        if (!descriptor) return null
        const Body = descriptor.component
        return (
          <div key={win.id} className="pointer-events-auto">
            <WindowFrame
              window={win}
              onClose={() => closeWindow(win.id)}
              onFocus={() => focusWindow(win.id)}
              onMinimise={() => minimiseWindow(win.id)}
              onToggleMaximise={() => toggleMaximise(win.id)}
              onMove={(rect) => moveWindow(win.id, rect)}
            >
              <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner /></div>}>
                <Body {...(win.props ?? {})} kind={win.kind} />
              </Suspense>
            </WindowFrame>
          </div>
        )
      })}
    </div>
  )
}
```

- [x] **Step 6: Write the dock**

`client/components/windows/dock.tsx`:

```tsx
"use client"

import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { WINDOW_REGISTRY } from "@/lib/windows/registry"
import { selectMinimised, useWindowStore } from "@/stores/window.store"

export function Dock() {
  // See WindowLayer — selectMinimised also returns a fresh array each call.
  const minimised = useWindowStore(useShallow(selectMinimised))
  const { restoreWindow, focusWindow } = useWindowStore.getState()

  if (minimised.length === 0) return null

  return (
    <div
      role="toolbar"
      aria-label="Minimised windows"
      className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-1 border-t border-border bg-background/80 px-3 py-1.5 backdrop-blur-xl"
    >
      {minimised.map((win) => {
        const Icon = WINDOW_REGISTRY[win.kind]?.icon
        return (
          <Button
            key={win.id}
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              restoreWindow(win.id)
              focusWindow(win.id)
            }}
          >
            {Icon && <Icon className="size-3.5" />}
            {win.title}
          </Button>
        )
      })}
      <span className="ml-auto text-xs text-muted-foreground">
        {minimised.length} minimised
      </span>
    </div>
  )
}
```

- [x] **Step 7: Run it and watch it pass**

```bash
pnpm --dir client test components/windows/window-layer
```

Expected: PASS, 6 tests. The "two concurrent windows" test is the one that proves the design's terminal-plus-voice requirement.

- [x] **Step 8: Commit**

```bash
git add client/lib/windows/registry.ts client/components/windows
git commit -m "feat(client): add window registry, layer and dock

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Auth window

**Files:**
- Create: `client/lib/api/provider.tsx`, `client/components/auth/auth-window.tsx`, `client/components/auth/sign-in-pane.tsx`, `client/components/auth/forgot-pane.tsx`, `client/components/auth/register-pane.tsx`, `client/components/auth/auth-window.test.tsx`
- Create: `client/.env.local.example`

**Interfaces:**
- Consumes: `createApiClient` (Task 3), `createAuthApi` (Task 4), `useAuthStore` (Task 5)
- Produces:
  - `<ApiProvider>` + `useApi()` → `{ client, auth }`
  - `<AuthWindow />`
  - `useSignIn()` → `{ signIn, status, error }`

- [x] **Step 1: Write the failing test**

`client/components/auth/auth-window.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiProvider } from "@/lib/api/provider"
import { useAuthStore } from "@/stores/auth.store"
import { AuthWindow } from "./auth-window"

const fetchImpl = vi.fn()

function renderAuth() {
  return render(
    <ApiProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
      <AuthWindow />
    </ApiProvider>,
  )
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("AuthWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    useAuthStore.getState().clear()
  })

  it("shows the sign-in form by default", () => {
    renderAuth()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument()
  })

  it("signs in and stores the principal", async () => {
    fetchImpl
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      .mockResolvedValueOnce(json({ id: "u1", kind: "user", role: "admin", email: "a@b.c" }))

    renderAuth()
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
    await userEvent.type(screen.getByLabelText(/password/i), "pw")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))

    await waitFor(() => {
      expect(useAuthStore.getState().principal?.email).toBe("a@b.c")
    })
    expect(useAuthStore.getState().accessToken).toBe("a-1")
  })

  it("shows the API's message when credentials are rejected", async () => {
    fetchImpl.mockResolvedValueOnce(
      json({ error: { code: "AUTH_INVALID_CREDENTIALS", message: "Invalid email or password", statusCode: 401, details: null, correlationId: "c", timestamp: "t", path: "/auth/login" } }, 401),
    )

    renderAuth()
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c")
    await userEvent.type(screen.getByLabelText(/password/i), "wrong")
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }))

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password")
    expect(useAuthStore.getState().principal).toBeNull()
  })

  it("hides Register and explains why when the flag is off", () => {
    renderAuth()
    expect(screen.queryByRole("tab", { name: /register/i })).not.toBeInTheDocument()
    expect(screen.getByText(/provisioned by an administrator/i)).toBeInTheDocument()
  })

  it("switches to the forgot-password pane", async () => {
    renderAuth()
    await userEvent.click(screen.getByRole("button", { name: /forgot your password/i }))
    expect(screen.getByRole("button", { name: /send reset code/i })).toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --dir client test components/auth/auth-window
```

Expected: FAIL — modules not found.

- [x] **Step 3: Write the API provider**

`client/lib/api/provider.tsx`:

```tsx
"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useAuthStore } from "@/stores/auth.store"
import { createApiClient, type ApiClient } from "./client"
import { createAuthApi, type AuthApi } from "./endpoints/auth"

interface ApiContextValue { client: ApiClient; auth: AuthApi }

const ApiContext = createContext<ApiContextValue | null>(null)

export function ApiProvider({
  children, baseUrl, fetchImpl,
}: {
  children: ReactNode
  baseUrl?: string
  fetchImpl?: typeof fetch
}) {
  const value = useMemo<ApiContextValue>(() => {
    const client = createApiClient({
      baseUrl: baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () =>
        useAuthStore.getState().refreshToken ?? useAuthStore.getState().readPersistedRefresh(),
      onTokens: (pair) => useAuthStore.getState().setTokens(pair),
      onAuthFailure: () => useAuthStore.getState().clear(),
      fetchImpl,
    })
    return { client, auth: createAuthApi(client) }
  }, [baseUrl, fetchImpl])

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error("useApi must be used inside <ApiProvider>")
  return ctx
}
```

- [x] **Step 4: Write the sign-in pane**

`client/components/auth/sign-in-pane.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/api/provider"
import { useAuthStore } from "@/stores/auth.store"

export function SignInPane({ onForgot }: { onForgot: () => void }) {
  const { auth } = useApi()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const pair = await auth.login({ email, password })
      useAuthStore.getState().setTokens(pair)
      const principal = await auth.me()
      useAuthStore.getState().setPrincipal(principal)
    } catch (err) {
      useAuthStore.getState().clear()
      setError(err instanceof ApiError ? err.message : "Could not sign in")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password" type="password" autoComplete="current-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {error && (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        )}

        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </Field>

        <Button type="button" variant="link" size="sm" onClick={onForgot} className="justify-start px-0">
          Forgot your password?
        </Button>
      </FieldGroup>
    </form>
  )
}
```

- [x] **Step 5: Write the forgot pane**

`client/components/auth/forgot-pane.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { useApi } from "@/lib/api/provider"

export function ForgotPane({ onBack }: { onBack: () => void }) {
  const { auth } = useApi()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    // The endpoint answers identically for known and unknown addresses, so
    // there is nothing to branch on and nothing to leak.
    try {
      await auth.forgotPassword(email)
    } finally {
      setSent(true)
      setPending(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          If an account exists for {email}, a reset code is on its way.
        </p>
        <Button variant="outline" onClick={onBack}>Back to sign in</Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
          <Input
            id="forgot-email" type="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
          <FieldDescription>We&apos;ll send a reset code to this address.</FieldDescription>
        </Field>
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Sending…" : "Send reset code"}
          </Button>
        </Field>
        <Button type="button" variant="link" size="sm" onClick={onBack} className="justify-start px-0">
          Back to sign in
        </Button>
      </FieldGroup>
    </form>
  )
}
```

- [x] **Step 6: Write the register pane**

`client/components/auth/register-pane.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/api/provider"
import { useAuthStore } from "@/stores/auth.store"
import type { TokenPair } from "@/lib/api/types"

/**
 * Gated behind NEXT_PUBLIC_ENABLE_REGISTER because `POST /auth/register` does
 * not exist yet — `users.controller.ts` is admin-only provisioning. The
 * contract below is the one recorded in the design doc §5.2.
 */
export function RegisterPane() {
  const { client } = useApi()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      const pair = await client.post<TokenPair>("/auth/register", {
        email, password, displayName: displayName || undefined,
      })
      useAuthStore.getState().setTokens(pair)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the account")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="reg-name">Name</FieldLabel>
          <Input id="reg-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="reg-email">Email</FieldLabel>
          <Input id="reg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="reg-password">Password</FieldLabel>
          <Input id="reg-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Field>
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}
```

- [x] **Step 7: Write the auth window**

`client/components/auth/auth-window.tsx`:

```tsx
"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ForgotPane } from "./forgot-pane"
import { RegisterPane } from "./register-pane"
import { SignInPane } from "./sign-in-pane"

const REGISTER_ENABLED = process.env.NEXT_PUBLIC_ENABLE_REGISTER === "true"

export function AuthWindow() {
  const [pane, setPane] = useState<"tabs" | "forgot">("tabs")

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <div aria-hidden className="text-2xl">◆</div>
        <h1 className="text-sm font-semibold tracking-widest">CYBERNETICS</h1>
      </div>

      {pane === "forgot" ? (
        <ForgotPane onBack={() => setPane("tabs")} />
      ) : REGISTER_ENABLED ? (
        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>
          <TabsContent value="signin" className="pt-4">
            <SignInPane onForgot={() => setPane("forgot")} />
          </TabsContent>
          <TabsContent value="register" className="pt-4">
            <RegisterPane />
          </TabsContent>
        </Tabs>
      ) : (
        <>
          <SignInPane onForgot={() => setPane("forgot")} />
          {/* Honest dead end rather than a Register button that 500s. */}
          <p className="text-center text-xs text-muted-foreground">
            Accounts are provisioned by an administrator.
          </p>
        </>
      )}
    </div>
  )
}
```

- [x] **Step 8: Write the env example**

`client/.env.local.example`:

```bash
# The API origin. No path prefix — the NestJS app calls setGlobalPrefix nowhere.
NEXT_PUBLIC_API_URL=http://localhost:3000

# POST /auth/register does not exist yet. Leave false until it does.
NEXT_PUBLIC_ENABLE_REGISTER=false
```

- [x] **Step 9: Run it and watch it pass**

```bash
pnpm --dir client test components/auth/auth-window
```

Expected: PASS, 5 tests.

- [x] **Step 10: Commit**

```bash
git add client/lib/api/provider.tsx client/components/auth client/.env.local.example
git commit -m "feat(client): add auth window with sign-in, forgot and gated register

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Shell — the `/core` route

Wires everything into a running app: providers, the canvas placeholder, the window layer, the dock, and a session bootstrap that refreshes from the persisted token on load.

**Files:**
- Create: `client/components/shell/shell-chrome.tsx`, `client/components/shell/use-session-bootstrap.ts`, `client/app/core/page.tsx`, `client/app/core/core-shell.tsx`
- Modify: `client/app/layout.tsx`, `client/app/page.tsx`
- Delete: `client/app/login/`, `client/app/signup/`, `client/app/dashboard/`

**Interfaces:**
- Consumes: everything from Tasks 3–11
- Produces: a running app at `/core`

- [x] **Step 1: Write the session bootstrap**

`client/components/shell/use-session-bootstrap.ts`:

```ts
"use client"

import { useEffect } from "react"
import { useApi } from "@/lib/api/provider"
import { useAuthStore } from "@/stores/auth.store"
import { useWindowStore } from "@/stores/window.store"

/**
 * On load: if a refresh token survived in storage, exchange it for a session
 * before deciding whether to show the auth window. Without this every reload
 * would bounce a signed-in user back to the login dialog.
 */
export function useSessionBootstrap(): void {
  const { auth } = useApi()

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const store = useAuthStore.getState()
      const persisted = store.readPersistedRefresh()

      if (!persisted) {
        useWindowStore.getState().openWindow({ kind: "auth", title: "Access", modal: true })
        return
      }

      store.setStatus("loading")
      try {
        const pair = await auth.refresh(persisted)
        if (cancelled) return
        useAuthStore.getState().setTokens(pair)
        const principal = await auth.me()
        if (cancelled) return
        useAuthStore.getState().setPrincipal(principal)
      } catch {
        if (cancelled) return
        useAuthStore.getState().clear()
        useWindowStore.getState().openWindow({ kind: "auth", title: "Access", modal: true })
      }
    }

    void boot()
    return () => { cancelled = true }
  }, [auth])
}
```

- [x] **Step 2: Write the shell chrome**

`client/components/shell/shell-chrome.tsx`:

```tsx
"use client"

import { LogOutIcon, MicIcon, TerminalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useApi } from "@/lib/api/provider"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"
import { useWindowStore } from "@/stores/window.store"

export function ShellChrome() {
  const { auth } = useApi()
  const principal = useAuthStore((s) => s.principal)
  const authed = useAuthStore(selectIsAuthenticated)
  const openWindow = useWindowStore((s) => s.openWindow)

  async function signOut() {
    const refresh = useAuthStore.getState().refreshToken
    if (refresh) await auth.logout(refresh).catch(() => undefined)
    useAuthStore.getState().clear()
    useWindowStore.getState().closeAll()
    useWindowStore.getState().openWindow({ kind: "auth", title: "Access", modal: true })
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3">
        <span className="pointer-events-auto select-none text-xs font-semibold tracking-widest text-muted-foreground">
          ◆ CYBERNETICS
        </span>

        {authed && (
          <div className="pointer-events-auto flex items-center gap-1">
            <Button
              variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => openWindow({ kind: "terminal", title: "Terminal" })}
            >
              <TerminalIcon className="size-3.5" /> Terminal
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs">
                  {principal?.displayName ?? principal?.email ?? "Account"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={signOut}>
                  <LogOutIcon className="size-3.5" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {authed && (
        <Button
          size="icon"
          aria-label="Live conversation"
          onClick={() => openWindow({ kind: "voice", title: "Live" })}
          className="pointer-events-auto absolute bottom-14 right-4 z-20 size-11 rounded-full shadow-lg"
        >
          <MicIcon className="size-4" />
        </Button>
      )}
    </>
  )
}
```

- [x] **Step 3: Write the core shell (client component)**

`client/app/core/core-shell.tsx`:

```tsx
"use client"

import { ShellChrome } from "@/components/shell/shell-chrome"
import { useSessionBootstrap } from "@/components/shell/use-session-bootstrap"
import { Dock } from "@/components/windows/dock"
import { WindowLayer } from "@/components/windows/window-layer"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"
import { cn } from "@/lib/utils"

export function CoreShell() {
  useSessionBootstrap()
  const authed = useAuthStore(selectIsAuthenticated)

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#00001c]">
      {/* Phase 2 replaces this with the 3D canvas. The fixed colour is
          deliberate — see design §4.3: the canvas is exempt from theme tokens. */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 transition-opacity duration-700",
          authed ? "opacity-100" : "pointer-events-none opacity-40",
        )}
      >
        <div className="flex h-full items-center justify-center">
          <span className="text-xs tracking-[0.3em] text-white/20">SYSTEM CORE</span>
        </div>
      </div>

      <WindowLayer />
      <ShellChrome />
      <Dock />
    </main>
  )
}
```

- [x] **Step 4: Write the route**

`client/app/core/page.tsx`:

```tsx
import { CoreShell } from "./core-shell"

export default function CorePage() {
  return <CoreShell />
}
```

- [x] **Step 5: Redirect the index route**

`client/app/page.tsx` — replace the whole file:

```tsx
import { redirect } from "next/navigation"

export default function Page() {
  redirect("/core")
}
```

- [x] **Step 6: Add the provider to the layout**

In `client/app/layout.tsx`, wrap the existing tree — keep `ThemeProvider` and `TooltipProvider` as they are:

```tsx
import { ApiProvider } from "@/lib/api/provider"
import { Toaster } from "@/components/ui/sonner"

// …inside <body>:
<ThemeProvider>
  <ApiProvider>
    <TooltipProvider>{children}</TooltipProvider>
    <Toaster />
  </ApiProvider>
</ThemeProvider>
```

- [x] **Step 7: Delete the scaffold demo routes**

```bash
rm -rf client/app/login client/app/signup client/app/dashboard
```

- [x] **Step 8: Verify the whole suite and the build**

```bash
pnpm --dir client test && pnpm --dir client typecheck && pnpm --dir client build
```

Expected: all tests pass, no type errors, build succeeds.

- [x] **Step 9: Verify against a running API**

```bash
cp client/.env.local.example client/.env.local   # edit if the API is not on :3000
pnpm --dir client dev
```

The API runs on `:3000`, the client on `:3100`. Then in the browser:

1. Visit `http://localhost:3100` → redirects to `/core`, auth dialog over a dimmed core.
2. Sign in with real credentials → dialog closes, chrome appears.
3. Click **Terminal**, then the **voice FAB** → **both windows open at once**. This is the design's core window requirement (§3, §7.2).
4. Drag each by its title bar; resize from the corner grip.
5. Minimise one → it appears in the dock; click it → restores.
6. **Reload** → still signed in, no auth dialog. Windows reopen empty — layout persistence is Phase 2 (see the deferred list below).
7. Open DevTools → Application → Local Storage: **only `cyb.refresh`**. Grep the whole storage for the access token value — it must not appear.
8. Network tab: every request carries `Authorization: Bearer …` and no cookies.
9. Sign out → windows close, auth dialog returns.

- [x] **Step 10: Commit**

```bash
git add client/app client/components/shell
git rm -r --cached client/app/login client/app/signup client/app/dashboard 2>/dev/null || true
git commit -m "feat(client): add /core shell with window layer, dock and session bootstrap

Replaces the Next scaffold demo routes. The app is now a single authenticated
route; navigation is window state, not URL state.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 self-review

Run before declaring the phase done.

| Design § | Requirement | Task |
|---|---|---|
| §2.1 | Single authenticated route `/core` | 12 |
| §2.2 | Persistent chrome, voice FAB, dock | 10, 12 |
| §2.3 | Windows become sheets under `md` | 9 |
| §3.1–3.2 | Window model, singletons, z-order, modal band, persistence exclusions | 6, 7 |
| §3.3 | `WindowFrame` owns all chrome; drag/resize; Esc | 8, 9 |
| §5.1 | Auth endpoints wired | 4 |
| §5.2 | Auth window; register gated behind a flag | 11 |
| §5.3 | Access token in memory; refresh persisted; single-flight refresh | 3, 5 |
| §10.1 | `auth` + `window` stores, persisted | 5, 7 |
| §10.3 | `lib/api/` is the only module that knows tokens | 3, 11 |

**Deferred to later phases, deliberately:** the 3D canvas (§4 → Phase 2), the terminal body and SSE transport (§6 → Phase 3), tables and upload (§8–9 → Phase 4), voice (§7 → Phase 5), and `localStorage` rehydration of the window layout, which Task 7 exposes via `serialiseForPersist`/`hydrate` but Task 12 only wires for auth. Wire window persistence in Phase 2 alongside the canvas, or add it as Task 13 if Phase 1 review asks for it.

---

## Phase 1 outcome (2026-09-06)

**Status: complete.** 92 tests across 11 files, `typecheck` clean, `build` clean,
verified in a real browser. 11 commits on `feat-client-foundation`.

### Deviations from the plan as written

| Plan said | What actually happened | Why |
|---|---|---|
| Append to a root `.gitignore` | Extended `client/.gitignore` | There is no root `.gitignore`; the repo uses per-directory files (`api/.gitignore`, `client/.gitignore`). Also had to add `!.env.local.example`, since the scaffold's `.env*` rule would have ignored the template. |
| Task 10 (registry) then Task 11 (auth window) | Landed together | Vite resolves `lazy(() => import(...))` at **transform** time, so the registry cannot reference `auth-window` before the file exists. Task 10's tests could not pass until Task 11 was written. |
| — | Fixed 3 pre-existing type errors in vendored `ai-elements` | `pnpm typecheck` was already red before any of this work (`ai@7` drift: `reasoningTokens`/`cachedInputTokens` moved into detail objects; `tool.description` may be a function). A permanently-red gate is useless. |
| `correlationId?: string` | `string \| number`, normalised to string | The live API returns `"correlationId": 3489`. It is `req.id` from nestjs-pino, a number — the backend's own `ErrorEnvelope` interface is inaccurate here. |
| Modal scrim `bg-background/60` | `bg-black/50` | `--background` is white in light mode, which washed the theme-exempt dark canvas to grey. Caught in the browser, not by a unit test. |
| `clampToViewport` naive `Math.min` | Floored at `MIN_DIMENSION` | A 0×0 viewport (SSR / pre-measurement) produced a negative width. |
| Create `client/.env.local` | Not created | Blocked by a permission deny rule on `.env.local`. Harmless: `ApiProvider` falls back to `http://localhost:3000`. **The user should create it from `.env.local.example`.** |

### Verified in a real browser

`/` → 307 → `/core` → 200 · auth dialog auto-opens client-side with full window
chrome · register replaced by "Accounts are provisioned by an administrator" ·
**zero console errors** · live API returns the expected envelope and
`Access-Control-Allow-Origin` with no `Allow-Credentials`.

### NOT verified — needs credentials

Sign-in with a real account, and therefore: reload-restores-session, sign-out,
and two windows open at once *in a browser* (the jsdom test covers the same
`WindowLayer → WindowFrame` path). Drag/resize is covered only at the
pure-function level; the pointer plumbing has not been exercised by hand.

### Carried into Phase 2

Window-layout persistence. `serialiseForPersist` and `hydrate` exist and are
tested, but nothing writes to or reads from `localStorage` yet — only the auth
session survives a reload.

---

# Phase 2: The 3D System Core

**Goal:** Replace the `SYSTEM CORE` placeholder with the real WebGL scene, with each rotating band bound to a live feature domain.

**Deps added:** `three@0.185.1`, `@react-three/fiber@9.7.0` (v9 is the React 19 line), `@types/three@0.185.4`.

## Porting decisions

The reference (`cybernetics-agentics/.../SystemCore`) splits cleanly into three groups:

| Group | Treatment |
|---|---|
| `scene/{palette,config,materials,labels}.ts`, `objects/*` | **Port near-verbatim.** Framework-free or pure R3F. Changes limited to: import paths, `@librechat/client` → local equivalents, and R3F v8 → v9 typing. |
| `scene/{tone,audio}.ts` | **Port verbatim** (42 KB, only depends on `three` + `./config`), but see *Audio* below. |
| `data/*` | **Does not exist.** Authored fresh, and much smaller than the reference's — only `Module`, `STATUS`, `bandText` are actually reachable from `Scene`/`resolve`, because `Panel`/`Form`/`Fields`/`List` are not being ported. |

### Audio is ported but defaults OFF

The reference builds a tone bus whenever motion is allowed, so the stack hums on open. Three reasons that is wrong here, none of which apply in the reference's modal-on-demand context:

1. Browsers refuse an `AudioContext` before a user gesture, so an auto-built bus is dead weight at best.
2. The core is now the **post-login landing surface** — an unprompted drone every session is hostile.
3. It is the single largest chunk of ported code serving the least of the design's stated goals.

So `createToneBus` is gated on `animate && soundEnabled`, `soundEnabled` defaults `false`, and a toolbar toggle turns it on. The seam already exists: `Scene`, `Strip` and `Hum` all accept `bus === null` and skip their voices.

### Reference bugs carried in, and fixed

The reference has three blocks commented out — `Contact` in `Strip.tsx`, the spine mesh in `Mainframe.tsx`, the sweep mesh in `Scanner.tsx`. `Scanner` still animates `sweepRef` every frame against a mesh that no longer renders, and `Strip` still computes `spec.lane` and takes a `scannerVisible` prop that nothing consumes. Ported with the dead paths **removed**, not carried over commented.

## Tasks

| # | Task | Verify |
|---|---|---|
| 13 | Port `scene/{palette,config}.ts` + author `data/status.ts`, `data/domains.ts` | Unit: `DOMAINS` endpoints all exist in `api/src/**/*.controller.ts` |
| 14 | Author `data/schema.ts` (`Module`, `bandText`, `blankModule`) + port `scene/resolve.ts` | Unit: `colorOf`/`gainOf`/`stripSpec` map status → numbers |
| 15 | Port `scene/materials.ts` + `scene/labels.ts` | Unit: registry shares by appearance, disposes, dims |
| 16 | Port `scene/{tone,audio}.ts` verbatim | Unit: `emitterOffset`, `roarLevel`, `humLevel` are pure and bounded |
| 17 | Port `objects/{Orbit,Mainframe,Scanner,Contact,Tone,Hum,Strip}.tsx` | Renders in a test canvas without throwing |
| 18 | Port `Scene.tsx` + `Boundary.tsx`, lazy-mount behind `next/dynamic({ssr:false})` | Canvas mounts, disposes cleanly on unmount |
| 19 | `stores/domain.store.ts` + `useDomainHealth()` | Unit: health resolves from counts; poll pauses when hidden |
| 20 | Wire into `CoreShell`; strip click opens that domain's window | Browser: strips turn; clicking one opens a window |
| 21 | Window-layout persistence (carried from Phase 1) | Reload restores open windows and their rects |

## Phase 2 definition of done

`pnpm test` green · `typecheck` clean · `build` clean · in a browser: the stack renders and turns, `prefers-reduced-motion` yields a static frame, closing the tab leaks no WebGL context, and a strip's colour tracks its domain's real row count.

## Phase 2 outcome (2026-09-06)

**Status: complete.** 157 tests across 17 files, `typecheck` clean, `build` clean,
verified in a browser. Tasks 13–21 done.

### Deviations from the Phase 2 plan

| Plan said | What happened | Why |
|---|---|---|
| Author `data/schema.ts` with a `Module` type | **Dropped it.** `Domain + Health → StripSpec` directly | The reference's Module exists because a side panel edits it. We do not port that panel and our strips are derived, so a Module had no consumer and no editor. |
| Port `objects/Contact.tsx` | Not ported | It is commented out in the reference. Its `lane`/`scannerVisible` plumbing was removed rather than carried as dead parameters. |
| Port `Scanner` as-is | **Sweep re-enabled** | The reference rotates `sweepRef` every frame against a mesh it has commented out — the animation drives nothing. The chrome exposes a scanner toggle, and a deck with no sweep is a grid. |
| Port `Boundary` as-is | **Added a retry** | The reference needed none: its core lived in a modal that unmounted on close. Ours never unmounts, so a lost WebGL context would be permanent. |
| — | `labels.ts` retargeted to `--font-mono` | The reference reads `--theme-font-family`, a LibreChat token that does not exist here. |
| `unknown` = `0x2a2a35 / gain 0.35` | `0x46536b / gain 0.62` | At the planned values the bands rendered near-black and the machine read as **broken**, not dormant. Only visible in a browser. |
| — | **Fixed a modal-scrim z-order bug** | The scrim had no `zIndex` while every window has one, so non-modal windows painted over it and nothing behind the auth dialog was dimmed. Regression test added; it fails without the fix. |

### Verified in a browser

The stack renders: eight bands between the two cap rings, each at its own radius,
arc and phase; band labels legible; scanner deck and sweep drawing; zero console
errors. Window layout survives a reload — Terminal and Live restored together
(**the design's terminal-plus-voice requirement, now proven outside jsdom**),
while an unregistered kind seeded into storage was correctly dropped.

### Still not verified — needs credentials

Strip colour tracking a **real** row count, and a strip click opening its
domain's window. `useDomainHealth` resets when signed out, so every band sits at
`unknown` until someone logs in. The mapping itself is unit-tested; the wiring
to live data is not.

### Carried forward

- Audio is ported and toggleable but has never been heard — no gesture has been
  made in a browser to unlock an `AudioContext`.
- `prefers-reduced-motion` yielding a static frame is implemented but untested
  in a browser.
