import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import { useTurnStore } from "@/stores/turn.store"
import { useConversationMutations } from "./use-conversation-mutations"

const fetchImpl = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function Harness() {
  const { rename, setStatus, remove } = useConversationMutations()
  return (
    <div>
      <button onClick={() => void rename("c1", "  Renamed  ")}>rename</button>
      <button onClick={() => void rename("c1", "   ")}>blank</button>
      <button onClick={() => void setStatus("c1", "archived")}>archive</button>
      <button onClick={() => void remove("c1")}>delete</button>
    </div>
  )
}

function renderHarness() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider
        baseUrl="https://api.test"
        fetchImpl={fetchImpl as unknown as typeof fetch}
      >
        <Harness />
      </StateProvider>
    </SWRConfig>,
  )
}

/** The request body of the last call, parsed. */
function lastBody() {
  const [, init] = fetchImpl.mock.calls.at(-1) as [string, RequestInit]
  return JSON.parse(init.body as string)
}

describe("useConversationMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTurnStore.getState().reset()
    fetchImpl.mockResolvedValue(json({ id: "c1" }))
    vi.stubGlobal("fetch", fetchImpl)
  })

  it("trims a rename before sending it", async () => {
    renderHarness()
    await userEvent.click(screen.getByText("rename"))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(lastBody()).toEqual({ title: "Renamed" })
  })

  /**
   * A whitespace-only rename must clear the override, not store a blank. Null is
   * what puts the row back on the Mastra-generated title; "" would pin the rail
   * to "Untitled" permanently.
   */
  it("sends null for a whitespace-only rename", async () => {
    renderHarness()
    await userEvent.click(screen.getByText("blank"))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(lastBody()).toEqual({ title: null })
  })

  it("sends the status on archive", async () => {
    renderHarness()
    await userEvent.click(screen.getByText("archive"))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(lastBody()).toEqual({ status: "archived" })
  })

  /**
   * Deleting the conversation currently on screen must clear the selection, or
   * the terminal keeps rendering a transcript whose row is gone and the next
   * message fetch 404s.
   */
  it("clears the selection when deleting the open conversation", async () => {
    useTurnStore.getState().selectConversation("c1")
    fetchImpl.mockResolvedValue(json(null, 204))
    renderHarness()
    await userEvent.click(screen.getByText("delete"))
    await waitFor(() =>
      expect(useTurnStore.getState().activeId).toBeNull(),
    )
  })

  it("leaves the selection alone when deleting a different conversation", async () => {
    useTurnStore.getState().selectConversation("c-other")
    fetchImpl.mockResolvedValue(json(null, 204))
    renderHarness()
    await userEvent.click(screen.getByText("delete"))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(useTurnStore.getState().activeId).toBe("c-other")
  })
})
