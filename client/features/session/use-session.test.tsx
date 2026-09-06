import { act, render, renderHook, screen, waitFor } from "@testing-library/react"
import { SWRConfig, useSWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { resetClientState } from "@/lib/state/reset"
import { StateProvider } from "@/lib/swr/provider"
import { useSessionStore } from "@/stores/session.store"
import { keys } from "@/lib/swr/keys"
import { useSession } from "./use-session"

const PRINCIPAL = { id: "u1", kind: "user" as const, email: "a@b.c" }

function wrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <SWRConfig value={{ provider: () => new Map(), fetcher, shouldRetryOnError: false, dedupingInterval: 0 }}>{children}</SWRConfig>
  }
}

/**
 * Like `wrapper`, but with SWR's own initial-mount fetch disabled. Used only
 * to isolate the `settling` formula from SWR's fetch-kickoff effect: without
 * `revalidateOnMount: false`, that effect fires within the same `act()` flush
 * that activates the key, leaving `isLoading` observably `true` by the time a
 * test can read `result.current` — which papers over the exact bug (SWR
 * momentarily reporting `isLoading: false` on the activation render itself).
 */
function staticWrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig
        value={{
          provider: () => new Map(),
          fetcher,
          shouldRetryOnError: false,
          dedupingInterval: 0,
          revalidateOnMount: false,
        }}
      >
        {children}
      </SWRConfig>
    )
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

  it("settles synchronously the instant a token lands, before SWR reports any verdict", () => {
    // SWR's `isLoading` is reported `false` on the render where a key first
    // activates (`isInitialMount` is already false by then, since it's set
    // once on the component's actual mount and never reset on key change).
    // `revalidateOnMount: false` keeps the hook pinned in exactly that state
    // (no fetch ever kicks off to later flip `isLoading` true), so a
    // `settling` expression that trusts `isLoading` alone reads this as a
    // resolved, non-settling session forever — never showing the gate for a
    // signed-in user whose principal genuinely never arrives.
    const { result } = renderHook(() => useSession(), {
      wrapper: staticWrapper(vi.fn()),
    })
    act(() => useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 900 }))
    expect(result.current.settling).toBe(true)
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

  it("does not leak the previous user's principal across a same-tab account switch", async () => {
    const ALICE = { id: "u1", kind: "user" as const, email: "alice@x.com" }
    const BOB = { id: "u2", kind: "user" as const, email: "bob@y.com" }

    // `keys.session()` is a constant tuple: SWR never refetches it on its own
    // just because `accessToken` changed (the token isn't part of the key), so
    // the real app never relies on that — `useSignIn.run()` seeds the cache
    // directly via `mutate(keys.session(), await auth.me(), {revalidate:
    // false})` AFTER `setTokens`. This test reproduces exactly that two-step
    // sequence (set tokens, THEN seed the cache) to expose the window that
    // `keepPreviousData` would fill with the previous user's data.
    let mutateRef: ReturnType<typeof useSWRConfig>["mutate"] | null = null

    function Harness() {
      const { mutate } = useSWRConfig()
      mutateRef = mutate
      const { principal } = useSession()
      return <span data-testid="email">{principal?.email ?? "none"}</span>
    }

    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        {/* The real production fetch path (StateProvider's own SWRConfig),
            not the bare `wrapper()` above, so this runs under exactly the
            config `useSession` gets in the app. That config used to set
            `keepPreviousData: true` app-wide for table pagination, which is
            what opened the window this test closes; it now lives on
            `useDomainTable` alone. fetchImpl is never called: nothing in this
            test relies on SWR's own auto-fetch. */}
        <StateProvider baseUrl="https://api.test" fetchImpl={vi.fn() as unknown as typeof fetch}>
          <Harness />
        </StateProvider>
      </SWRConfig>,
    )

    // Alice signs in: set tokens, then seed the cache — mirrors `useSignIn`.
    await act(async () => {
      useSessionStore.getState().setTokens({ accessToken: "a-1", refreshToken: "ra", expiresIn: 900 })
      await mutateRef!(keys.session(), ALICE, { revalidate: false })
    })
    expect(screen.getByTestId("email")).toHaveTextContent("alice@x.com")

    // Sign out through the REAL reset path: it evicts the cache entry, but
    // does not (and structurally cannot, from outside the hook) clear SWR's
    // per-hook `keepPreviousData` ref — which is why `useSession` must never
    // be given that option, by its own call site or by a global default.
    act(() => resetClientState(mutateRef))

    // Bob signs in: `setTokens` lands first, exactly as `useSignIn.run()`
    // does — his principal has not reached the cache yet.
    act(() => {
      useSessionStore.getState().setTokens({ accessToken: "b-1", refreshToken: "rb", expiresIn: 900 })
    })

    // The critical instant: Bob's own principal has not been written to the
    // cache yet. `principal` must never read back Alice's.
    expect(screen.getByTestId("email")).not.toHaveTextContent("alice@x.com")

    await act(async () => {
      await mutateRef!(keys.session(), BOB, { revalidate: false })
    })

    expect(screen.getByTestId("email")).toHaveTextContent("bob@y.com")
  })
})
