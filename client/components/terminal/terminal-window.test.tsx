import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SseEvent } from "@/lib/agent/types"
import { ApiProvider } from "@/lib/api/provider"
import { useConversationStore } from "@/stores/conversation.store"
import { TerminalWindow } from "./terminal-window"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

function frame(e: SseEvent) {
  return `data: ${JSON.stringify(e)}\n\n`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** A Response whose body streams the given SSE events. */
function sseResponse(events: SseEvent[]) {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(frame(e)))
        c.close()
      },
    }),
    { status: 200 },
  )
}

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 20 }

const fetchImpl = vi.fn()

function renderTerminal() {
  return render(
    <ApiProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
      <TerminalWindow />
    </ApiProvider>,
  )
}

describe("TerminalWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useConversationStore.getState().reset()
    // The stream transport reads the global fetch, not the injected one.
    vi.stubGlobal("fetch", fetchImpl)
  })

  it("shows the empty state with suggestions", async () => {
    fetchImpl.mockResolvedValue(json(EMPTY_PAGE))
    renderTerminal()
    expect(await screen.findByText("Ask the system")).toBeInTheDocument()
    expect(screen.getByText("Summarise my open tasks")).toBeInTheDocument()
  })

  it("lists conversations in the rail", async () => {
    fetchImpl.mockResolvedValue(
      json({
        data: [
          {
            id: "c1",
            title: "Q3 report",
            kind: "chat",
            status: "active",
            lastMessageAt: null,
            messageCount: 2,
            createdAt: "t",
            updatedAt: "t",
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      }),
    )
    renderTerminal()
    expect(await screen.findByRole("button", { name: "Q3 report" })).toBeInTheDocument()
  })

  it("surfaces a rail load failure", async () => {
    fetchImpl.mockResolvedValue(
      json({ error: { code: "UNKNOWN", message: "unreachable", statusCode: 500 } }, 500),
    )
    renderTerminal()
    expect(await screen.findByRole("alert")).toHaveTextContent("unreachable")
  })

  it("sends a message and renders the streamed reply", async () => {
    fetchImpl.mockImplementation((url: string) => {
      if (String(url).endsWith("/agent/chat/stream")) {
        return Promise.resolve(
          sseResponse([
            { type: "start", conversationId: "c1", runId: "r1" },
            { type: "text-delta", delta: "Three tasks " },
            { type: "text-delta", delta: "remain open." },
            { type: "done", status: "succeeded" },
          ]),
        )
      }
      return Promise.resolve(json(EMPTY_PAGE))
    })

    renderTerminal()
    await screen.findByText("Ask the system")

    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "status?")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    expect(await screen.findByText("Three tasks remain open.")).toBeInTheDocument()
    // the user's own message is echoed optimistically
    expect(screen.getByText("status?")).toBeInTheDocument()
  })

  it("renders a tool call and its result", async () => {
    fetchImpl.mockImplementation((url: string) => {
      if (String(url).endsWith("/agent/chat/stream")) {
        return Promise.resolve(
          sseResponse([
            { type: "start", conversationId: "c1", runId: "r1" },
            {
              type: "tool-input",
              toolCallId: "tc1",
              toolName: "search-documents",
              args: { query: "Q3" },
            },
            {
              type: "tool-output",
              toolCallId: "tc1",
              toolName: "search-documents",
              result: { hits: 2 },
              isError: false,
            },
            { type: "done", status: "succeeded" },
          ]),
        )
      }
      return Promise.resolve(json(EMPTY_PAGE))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "find Q3")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    expect(await screen.findByText(/search-documents/)).toBeInTheDocument()
  })

  it("shows the approval gate and resumes on Approve", async () => {
    const bodies: string[] = []
    fetchImpl.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/agent/chat/stream")) {
        bodies.push(String(init?.body))
        // First turn pauses for approval; the resume completes it.
        return Promise.resolve(
          bodies.length === 1
            ? sseResponse([
                { type: "start", conversationId: "c1", runId: "r1" },
                {
                  type: "approval-required",
                  approvalId: "ap1",
                  toolCallId: "tc1",
                  toolName: "send-email",
                  actionType: "send_email",
                  title: "Send to 3 recipients",
                  payload: { to: ["a@b.c"] },
                },
                { type: "done", status: "awaiting_approval" },
              ])
            : sseResponse([
                { type: "start", conversationId: "c1", runId: "r2" },
                { type: "text-delta", delta: "Sent." },
                { type: "done", status: "succeeded" },
              ]),
        )
      }
      return Promise.resolve(json(EMPTY_PAGE))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "email them")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    expect(await screen.findByText("Approval required")).toBeInTheDocument()
    expect(screen.getByText("Send to 3 recipients")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Approve" }))

    expect(await screen.findByText("Sent.")).toBeInTheDocument()

    // The decision must resume the stream, not POST /agent/approvals/:id —
    // only the resume path streams the rest of the turn back.
    const resume = JSON.parse(bodies[1])
    expect(resume).toMatchObject({ resume: { approvalId: "ap1", approved: true } })
  })

  it("surfaces a stream error without losing the transcript", async () => {
    fetchImpl.mockImplementation((url: string) => {
      if (String(url).endsWith("/agent/chat/stream")) {
        return Promise.resolve(
          sseResponse([
            { type: "start", conversationId: "c1", runId: "r1" },
            { type: "text-delta", delta: "Partial " },
            { type: "error", message: "model unavailable" },
          ]),
        )
      }
      return Promise.resolve(json(EMPTY_PAGE))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "go")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText("Partial")).toBeInTheDocument()
    })
  })
})
