import { act, renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useAuthGate } from "./use-auth-gate"
import { useSession } from "./use-session"

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

  it("does not flash the gate at a returning user mid-refresh", async () => {
    // `settling` is a three-way disjunction, and this case is only about the
    // `refreshing` term — so the other two are deliberately falsified rather
    // than left to overlap. `accessToken` is set, which kills
    // `refreshToken && !accessToken`; the principal fetch is made to FAIL,
    // which kills `accessToken && (isLoading || (!data && !error))` once the
    // rejection lands. No principal also means `authed` is false, so the gate
    // is not being held shut by a resolved session either. What is left is
    // `refreshing`, and nothing else.
    useSessionStore.setState({ accessToken: "a", refreshToken: "r", refreshing: true })
    const { result } = renderHook(
      () => {
        useAuthGate(true)
        return useSession()
      },
      { wrapper: wrapper(vi.fn().mockRejectedValue(new Error("no principal"))) },
    )

    // The verdict must have landed before the assertion: until it does, the
    // third disjunct is still true and the gate would stay shut for a reason
    // this test is not about.
    await waitFor(() => expect(result.current.error).toBeDefined())
    expect(gate()).toBeUndefined()
    // Belt and braces: `refreshing` really is the term still holding it.
    expect(result.current.settling).toBe(true)
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

  /**
   * Inverts the old `use-auth-window.test.tsx` expectation of the same name.
   * The gate used to reopen itself the instant it went missing — `gateId` sat
   * in the effect's dependency array — which is what made it the one window
   * over the core that could not be closed. It is now offered once per
   * signed-out episode, and "Sign in" in the shell chrome summons it back.
   */
  it("stays closed once dismissed while still signed out", async () => {
    const { rerender } = renderHook(() => useAuthGate(true), { wrapper: wrapper(vi.fn()) })
    await waitFor(() => expect(gate()).toBeDefined())

    act(() => useWorkspaceStore.getState().closeWindow(gate()!.id))
    rerender()
    rerender()

    expect(gate()).toBeUndefined()
  })

  it("raises the gate again on a later sign-out", async () => {
    // The episode latch has to re-arm, or an expiry mid-session would drop the
    // user onto an inert surface with no prompt.
    renderHook(() => useAuthGate(true), { wrapper: wrapper(async () => PRINCIPAL) })
    await waitFor(() => expect(gate()).toBeDefined())

    act(() =>
      useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 60 }),
    )
    await waitFor(() => expect(gate()).toBeUndefined())

    act(() => useSessionStore.getState().clear())
    await waitFor(() => expect(gate()).toBeDefined())
  })
})
