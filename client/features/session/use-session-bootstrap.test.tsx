import { render, renderHook, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import { SESSION_STORAGE_KEY, useSessionStore } from "@/stores/session.store"
import { useStateHydration } from "@/features/state-hydration"
import { useSession } from "./use-session"
import { useSessionBootstrap } from "./use-session-bootstrap"

function Shell() {
  const hydrated = useStateHydration()
  useSessionBootstrap(hydrated)
  const { principal } = useSession()
  return <span data-testid="email">{principal?.email ?? "none"}</span>
}

function renderShell(fetchImpl: typeof fetch) {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl}>
        <Shell />
      </StateProvider>
    </SWRConfig>,
  )
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * `lib/swr/provider.tsx`'s `getRefreshToken` used to fall back to
 * `useSessionStore.getState().readPersistedRefresh()`, a direct localStorage
 * read, because the store had no hydration step of its own. Task 13 gave the
 * store real `persist` + `skipHydration`, and Task 14's `useStateHydration`
 * rehydrates it before anything else runs — which is supposed to make that
 * fallback redundant. These tests exercise the two places a stale-or-missing
 * in-memory refresh token would actually bite: the boot-time exchange, and a
 * 401-triggered refresh inside the api client — with the fallback function
 * gone entirely (it would be a compile error if either path still needed it).
 */
describe("a returning user's session resumes without the api client's refresh-token fallback", () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionStore.getState().clear()
  })

  it("exchanges the token straight from hydrated store state, not a fallback read", async () => {
    // The bare-string shape the OLD store wrote directly to localStorage,
    // with no persist envelope. Only `useStateHydration`'s rehydrate (via the
    // legacy-aware storage adapter) can turn this into `refreshToken` on the
    // store — there is no other way this value reaches the api client.
    localStorage.setItem(SESSION_STORAGE_KEY, "r-legacy")

    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      .mockResolvedValue(json({ id: "u1", kind: "user", email: "a@b.c" }))

    renderShell(fetchImpl as unknown as typeof fetch)

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.test/auth/refresh")
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toEqual({
      refreshToken: "r-legacy",
    })

    await waitFor(() => expect(useSessionStore.getState().accessToken).toBe("a-1"))
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("a@b.c"))
  })

  it("also resolves a 401-triggered refresh inside the api client from state alone", async () => {
    localStorage.setItem(SESSION_STORAGE_KEY, "r-legacy")

    const fetchImpl = vi
      .fn()
      // 1: the boot-time exchange.
      .mockResolvedValueOnce(json({ accessToken: "a-1", refreshToken: "r-1", expiresIn: 900 }))
      // 2: the first /auth/me, rejected as an expired access token — this is
      // what drives the api client's OWN internal refresh, the exact code
      // path `getRefreshToken` serves.
      .mockResolvedValueOnce(
        json(
          { error: { code: "AUTH_TOKEN_EXPIRED", message: "expired", statusCode: 401 } },
          401,
        ),
      )
      // 3: the client's internal refresh call.
      .mockResolvedValueOnce(json({ accessToken: "a-2", refreshToken: "r-2", expiresIn: 900 }))
      // 4: the retried /auth/me, now with the fresh token.
      .mockResolvedValue(json({ id: "u1", kind: "user", email: "a@b.c" }))

    renderShell(fetchImpl as unknown as typeof fetch)

    // The internal refresh (call 3) must carry "r-1" — the token `setTokens`
    // just put in memory a moment earlier — proving `getRefreshToken` needed
    // nothing but current store state.
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3))
    const refreshCall = fetchImpl.mock.calls.find(
      (call) => call[0] === "https://api.test/auth/refresh" && call !== fetchImpl.mock.calls[0],
    )
    expect(refreshCall).toBeDefined()
    expect(JSON.parse(refreshCall![1].body as string)).toEqual({ refreshToken: "r-1" })

    await waitFor(() => expect(useSessionStore.getState().accessToken).toBe("a-2"))
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("a@b.c"))
  })
})

describe("useSessionBootstrap robustness", () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionStore.getState().clear()
  })

  /**
   * `refreshing` gates `settling` (use-session.ts), so stranding it at `true`
   * shuts the auth gate for good. The effect's `cancelled` guard exists to
   * stop a stale response from overwriting NEWER state after an unmount — but
   * `setRefreshing(false)` isn't "newer state" being clobbered, it's just
   * clearing a flag, and skipping it here has no correctness upside.
   */
  it("does not strand refreshing:true when the component unmounts mid-exchange", async () => {
    useSessionStore.setState({ refreshToken: "r-1" })
    let resolveRefresh!: (value: Response) => void
    const fetchImpl = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => (resolveRefresh = resolve)),
    )

    const { unmount } = renderShell(fetchImpl as unknown as typeof fetch)
    await waitFor(() => expect(useSessionStore.getState().refreshing).toBe(true))

    unmount()
    resolveRefresh(json({ accessToken: "a-1", refreshToken: "r-2", expiresIn: 900 }))

    await waitFor(() => expect(useSessionStore.getState().refreshing).toBe(false))
  })

  /**
   * `auth.service.ts` rotates the refresh token on a compare-and-set: by the
   * time this promise resolves, the exchange has ALREADY succeeded
   * server-side and the old token is dead, whether or not anything is still
   * mounted to receive the answer. Discarding the new pair here would leave
   * the dead old token as the only one `partialize` ever persists — the next
   * load sends it, the backend reads a used token as reuse/theft, and revokes
   * the whole family. Silently and permanently logging the user out is
   * strictly worse than never having refreshed at all.
   */
  it("keeps a rotated token pair even if the shell unmounts mid-exchange", async () => {
    useSessionStore.setState({ refreshToken: "r-1" })
    let resolveRefresh!: (value: Response) => void
    const fetchImpl = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => (resolveRefresh = resolve)),
    )

    const { unmount } = renderShell(fetchImpl as unknown as typeof fetch)
    await waitFor(() => expect(useSessionStore.getState().refreshing).toBe(true))

    unmount()
    resolveRefresh(json({ accessToken: "new-a", refreshToken: "new-r", expiresIn: 60 }))

    await waitFor(() => expect(useSessionStore.getState().refreshToken).toBe("new-r"))
    expect(useSessionStore.getState().accessToken).toBe("new-a")
  })

  /**
   * React's StrictMode double-invokes an effect's setup/cleanup once at
   * mount, which is what would happen here if `useSessionBootstrap` ever ran
   * with `hydrated` already `true` on first render (the App Router enables
   * StrictMode by default). Reproduced directly, rather than through
   * `<StrictMode>` itself: `useStateHydration`'s own async gating means
   * `hydrated` is always `false` on a component's actual first render, which
   * sidesteps React's mount-time double-invoke window entirely and would
   * make a `<StrictMode>`-based test pass without exercising the latch at
   * all. Two separate hook instances racing on the SAME module-level state —
   * both mounting with `hydrated=true` and seeing `accessToken === null` — is
   * the same hazard: without a single-flight latch, both fire their own
   * `POST /auth/refresh` with the SAME token, which `auth.service.ts`'s
   * compare-and-set rotation treats as theft, revoking the whole family.
   */
  it("does not fire a second refresh when two hook instances race on the same refresh token", async () => {
    useSessionStore.setState({ refreshToken: "r-1" })
    const fetchImpl = vi
      .fn()
      .mockImplementation(() => json({ accessToken: "a-1", refreshToken: "r-2", expiresIn: 900 }))

    function wrapper({ children }: { children: ReactNode }) {
      return (
        <SWRConfig value={{ provider: () => new Map() }}>
          <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
            {children}
          </StateProvider>
        </SWRConfig>
      )
    }

    renderHook(() => useSessionBootstrap(true), { wrapper })
    renderHook(() => useSessionBootstrap(true), { wrapper })

    await waitFor(() => expect(useSessionStore.getState().accessToken).toBe("a-1"))
    const refreshCalls = fetchImpl.mock.calls.filter(
      (call) => call[0] === "https://api.test/auth/refresh",
    )
    expect(refreshCalls).toHaveLength(1)
  })
})
