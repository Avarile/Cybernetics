import { act, render, renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useTurnStore } from "@/stores/turn.store"
import { IN_FLIGHT_ID, useMessages } from "./use-messages"

const STORED = [
  { id: "m1", role: "user" as const, createdAt: "t", parts: [{ type: "text" as const, text: "old" }] },
]

/** What the server has already persisted by the time a turn's `start` frame
 *  reveals the conversation id: the user's message. */
const STORED_WITH_USER = [
  { id: "u1", role: "user" as const, createdAt: "t", parts: [{ type: "text" as const, text: "hi" }] },
]

/** A cache two mounts can share, so a remount sees what the first mount
 *  fetched — as it does in the app, where the SWR cache is global. */
function newCache() {
  return new Map()
}

function wrapper(
  fetcher: (key: readonly unknown[]) => Promise<unknown>,
  cache?: ReturnType<typeof newCache>,
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig
        value={{
          provider: () => cache ?? newCache(),
          fetcher,
          shouldRetryOnError: false,
          dedupingInterval: 0,
          // No `keepPreviousData`. It used to be on globally for table
          // pagination and this wrapper mirrored that; it now lives on
          // `useDomainTable` alone, so SWR's default is what this hook
          // actually runs under. The behaviour that turns on it — a null key
          // after a real one — is the "returns to a new chat" case below, and
          // the global default itself is pinned in lib/swr/provider.test.tsx.
        }}
      >
        {children}
      </SWRConfig>
    )
  }
}

/**
 * The sequence a brand-new conversation really goes through: the optimistic
 * row and the turn both open while `activeId` is still null, and only the
 * `start` frame reveals the id — which is what makes the SWR key materialise
 * mid-turn and fetch a history the server has already written the user's
 * message into.
 */
async function beginNewConversationTurn(fetcher: () => unknown, rerender: () => void) {
  useTurnStore.getState().appendOptimistic("hi")
  useTurnStore.getState().beginTurn()
  rerender()
  useTurnStore.getState().applyEvent({ type: "start", conversationId: "c1", runId: "r1" })
  rerender()
  await waitFor(() => expect(fetcher).toHaveBeenCalled())
  // Let the fetch resolve into the cache, so the assertions below are made
  // against a hook that has actually seen the server's copy.
  await act(async () => {
    await Promise.resolve()
  })
  rerender()
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

    // With no optimistic rows and no turn, `base` is just `data` itself — the
    // same reference either way, memoized or not. That branch alone doesn't
    // prove memoization: force the spread branch (stored + optimistic), which
    // a non-memoized implementation would rebuild as a new array every render
    // even with unchanged inputs.
    useTurnStore.getState().appendOptimistic("new")
    rerender()
    const first = result.current.messages
    rerender()
    expect(result.current.messages).toBe(first)
  })

  it("returns to a new chat after a conversation was open", async () => {
    useTurnStore.getState().selectConversation("c1")
    const { result, rerender } = renderHook(() => useMessages(), { wrapper: wrapper(async () => STORED) })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    // SWR's laggy-data ref has no guard for a null key, so under
    // `keepPreviousData` this would keep reporting c1's transcript instead of
    // the empty state. That is why the app-wide default is off.
    useTurnStore.getState().selectConversation(null)
    rerender()
    expect(result.current.messages).toEqual([])
  })

  it("renders the user's message once when a new conversation's key materialises mid-turn", async () => {
    const fetcher = vi.fn(async () => STORED_WITH_USER)
    const { result, rerender } = renderHook(() => useMessages(), { wrapper: wrapper(fetcher) })
    // A brand-new chat has no id, so nothing is fetched up front.
    expect(fetcher).not.toHaveBeenCalled()

    await beginNewConversationTurn(fetcher, rerender)

    // The server's copy of "hi" is in the cache and `optimistic` still holds
    // the client's. Exactly one row renders, and it is the optimistic one.
    expect(result.current.messages.map((m) => m.id)).toEqual([expect.stringMatching(/^local-/)])

    // Proof the fetch really landed — without it the assertion above could
    // pass merely because nothing had arrived. `settle` lifts the freeze and
    // clears `optimistic`; the stored row appears in its place, still once.
    // There is no await in between, so the cache already held it.
    useTurnStore.getState().settle()
    rerender()
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1"])
  })

  it("keeps a message the user repeated, rather than reading it as the server's echo", async () => {
    useTurnStore.getState().selectConversation("c1")
    const { result, rerender } = renderHook(() => useMessages(), {
      wrapper: wrapper(async () => STORED_WITH_USER),
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))

    // Sending never refetches, so `stored` is stale and cannot contain THIS
    // "hi" — only the earlier one. Any de-duplication by text would read the
    // new row as an echo and hide the message the user just sent.
    useTurnStore.getState().appendOptimistic("hi")
    useTurnStore.getState().beginTurn()
    rerender()
    expect(result.current.messages.map((m) => m.id)).toEqual([
      "u1",
      expect.stringMatching(/^local-/),
    ])
  })

  it("leaves no duplicate behind when a turn ends interrupted", async () => {
    const fetcher = vi.fn(async () => STORED_WITH_USER)
    const { result, rerender } = renderHook(() => useMessages(), { wrapper: wrapper(fetcher) })

    await beginNewConversationTurn(fetcher, rerender)

    // `use-agent-chat` deliberately skips `settle()` on an interrupted turn,
    // so nothing will ever clear `optimistic`: a duplicate here is permanent,
    // not a settling race.
    useTurnStore.getState().interruptTurn()
    rerender()

    const users = result.current.messages.filter((m) => m.role === "user")
    expect(users).toHaveLength(1)
    // And it must not have vanished either — the other way to score one row.
    expect(users[0]!.parts).toEqual([{ type: "text", text: "hi" }])
  })

  it("never blanks the transcript for the frame before the snapshot is taken", async () => {
    // `live` flips one render before the effect that takes the snapshot, so on
    // that render `stored` falls back to `data`. Without the fallback the
    // transcript would render empty for exactly one frame — invisible to any
    // assertion made after `act()`, since effects have flushed by then.
    // Recording every render is what makes that frame observable at all.
    useTurnStore.getState().selectConversation("c1")
    const seen: string[][] = []
    function Probe() {
      seen.push(useMessages().messages.map((m) => m.id))
      return null
    }
    render(<Probe />, { wrapper: wrapper(async () => STORED) })
    await waitFor(() => expect(seen.at(-1)).toEqual(["m1"]))

    seen.length = 0
    act(() => {
      useTurnStore.getState().appendOptimistic("new")
      useTurnStore.getState().beginTurn()
    })

    expect(seen.length).toBeGreaterThan(0)
    for (const frame of seen) expect(frame).toContain("m1")
  })

  it("holds the freeze across an unmount, so a minimised terminal returns undoubled", async () => {
    // Minimising the terminal really does unmount it: `selectOpenWindows`
    // filters minimised windows out of the window layer. `useAgentChat`'s
    // unmount cleanup then aborts the stream, which cancels the turn down the
    // branch that never calls `settle()` — so `turn` and `optimistic` are both
    // still set when the user restores it from the dock. A snapshot held in a
    // hook-local ref dies at that unmount while the state it guards does not.
    const cache = newCache()
    const fetcher = vi.fn(async () => STORED_WITH_USER)
    const first = renderHook(() => useMessages(), { wrapper: wrapper(fetcher, cache) })

    await beginNewConversationTurn(fetcher, first.rerender)
    expect(first.result.current.messages.map((m) => m.id)).toEqual([
      expect.stringMatching(/^local-/),
    ])

    first.unmount()
    // The store is module-global and outlives the component, exactly as it
    // does behind a minimised window.
    expect(useTurnStore.getState().turn).not.toBeNull()
    expect(useTurnStore.getState().optimistic).toHaveLength(1)

    const second = renderHook(() => useMessages(), { wrapper: wrapper(fetcher, cache) })
    expect(second.result.current.messages.map((m) => m.id)).toEqual([
      expect.stringMatching(/^local-/),
    ])

    // Not vacuous: the shared cache really does hold the server's copy of the
    // message. Lifting the freeze shows it, synchronously, in the optimistic
    // row's place.
    useTurnStore.getState().settle()
    second.rerender()
    expect(second.result.current.messages.map((m) => m.id)).toEqual(["u1"])
  })
})
