import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { SseEvent } from "@/lib/agent/types"
import { StateProvider } from "@/lib/swr/provider"
import { useTurnStore } from "@/stores/turn.store"
import { SWRConfig } from "swr"
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

/** A Response whose body streams `events`, then a final frame with no
 *  trailing blank line — the connection dropping mid-event, same as a real
 *  cut. `SseParser` still parses the dangling frame (it's complete JSON, just
 *  unterminated), but reports `hasPartial`, so `streamChat` returns
 *  `truncated: true` and the caller marks the turn interrupted rather than
 *  settled. */
function truncatedSseResponse(events: SseEvent[], dangling: SseEvent) {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(frame(e)))
        c.enqueue(enc.encode(`data: ${JSON.stringify(dangling)}`))
        c.close()
      },
    }),
    { status: 200 },
  )
}

const EMPTY_PAGE = { data: [], total: 0, page: 1, limit: 20 }

/**
 * The response for any request a test isn't specifically stubbing: the rail's
 * list envelope for `/agent/conversations`, or an empty history array for
 * `/agent/conversations/:id/messages`.
 *
 * The two are not interchangeable — the messages endpoint returns a bare
 * array, not a paginated envelope — and once a turn's `start` frame learns a
 * conversation id, `useMessages` fetches that conversation's history
 * immediately, mid-stream. A single EMPTY_PAGE fallback for both breaks that
 * fetch with "stored is not iterable".
 *
 * The empty array here is a FALLBACK, not a model of the backend. A real
 * server has persisted the user's message by the time that mid-stream fetch
 * lands, and returning `[]` is what hid the bug where it came back and
 * rendered alongside the still-live optimistic copy — the same message twice.
 * Any test that cares about the transcript's shape must therefore stub a
 * NON-EMPTY history containing the user's message: see the interrupted-turn
 * case below, which is the one where the duplicate is permanent.
 */
function defaultResponse(url: string) {
  if (/\/agent\/conversations\/[^/]+\/messages$/.test(url)) return json([])
  return json(EMPTY_PAGE)
}

/**
 * Fakes the messages endpoint for a conversation whose turn is about to
 * settle, returning what a real backend would by then have persisted — the
 * user's message and the assistant's reply.
 *
 * Deliberately NOT gated by call count. `useMessages`'s key resolves the
 * instant a turn's `start` frame reveals the conversation id, mid-stream —
 * that automatic fetch races the explicit revalidate that follows the stream
 * closing, and SWR dedupes concurrent requests for the same key, so which one
 * actually reaches the network is not deterministic. A response that doesn't
 * depend on that race removes the flake.
 */
function historyResponse(history: unknown[]) {
  return () => json(history)
}

/**
 * Fakes the messages endpoint for a turn that must NOT revalidate at all
 * (failed / interrupted / cancelled): `before` is returned on the one
 * automatic fetch `useMessages` makes when `start` first reveals the
 * conversation id, and `after` — what the server would report *if asked
 * again*, e.g. once it finished the run despite the client's stream dropping
 * — is returned on any further call. Unlike `historyResponse`, gating by call
 * count is safe here: with the fix, no second call is even possible, so there
 * is no race to collapse two calls into one non-deterministically.
 *
 * `before` still carries the user's own message. That fetch is mid-stream, so
 * the assistant's reply cannot be in it — but the user's message was persisted
 * the moment the request arrived, well before `start` was even emitted.
 */
function historyOnceMore(before: unknown[], after: unknown[]) {
  let calls = 0
  return () => json(calls++ === 0 ? before : after)
}

const fetchImpl = vi.fn()

function renderTerminal() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <TerminalWindow />
      </StateProvider>
    </SWRConfig>,
  )
}

describe("TerminalWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTurnStore.getState().reset()
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
    const messagesGate = historyResponse([
      { id: "u1", role: "user", createdAt: "t", parts: [{ type: "text", text: "status?" }] },
      { id: "a1", role: "assistant", createdAt: "t", parts: [{ type: "text", text: "Three tasks remain open." }] },
    ])
    fetchImpl.mockImplementation((url: string) => {
      const href = String(url)
      if (href.endsWith("/agent/chat/stream")) {
        return Promise.resolve(
          sseResponse([
            { type: "start", conversationId: "c1", runId: "r1" },
            { type: "text-delta", delta: "Three tasks " },
            { type: "text-delta", delta: "remain open." },
            { type: "done", status: "succeeded" },
          ]),
        )
      }
      if (/\/agent\/conversations\/[^/]+\/messages$/.test(href)) return Promise.resolve(messagesGate())
      return Promise.resolve(defaultResponse(href))
    })

    renderTerminal()
    await screen.findByText("Ask the system")

    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "status?")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    expect(await screen.findByText("Three tasks remain open.")).toBeInTheDocument()
    // The user's own message is echoed optimistically, and exactly once: the
    // stubbed history contains it too, so a transcript that rendered `stored`
    // and `optimistic` together mid-turn would show it twice.
    expect(screen.getAllByText("status?")).toHaveLength(1)
  })

  it("renders a tool call and its result", async () => {
    const messagesGate = historyResponse([
      {
        id: "a1",
        role: "assistant",
        createdAt: "t",
        parts: [
          {
            type: "tool",
            toolCallId: "tc1",
            toolName: "search-documents",
            state: "output-available",
            input: { query: "Q3" },
            output: { hits: 2 },
          },
        ],
      },
    ])
    fetchImpl.mockImplementation((url: string) => {
      const href = String(url)
      if (href.endsWith("/agent/chat/stream")) {
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
      if (/\/agent\/conversations\/[^/]+\/messages$/.test(href)) return Promise.resolve(messagesGate())
      return Promise.resolve(defaultResponse(href))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "find Q3")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    expect(await screen.findByText(/search-documents/)).toBeInTheDocument()
  })

  it("shows the approval gate and resumes on Approve", async () => {
    const bodies: string[] = []
    let messagesCalls = 0
    // The user's message is in the history because the server persists it the
    // moment the request arrives — long before the turn pauses for approval.
    const messagesGate = historyResponse([
      { id: "u1", role: "user", createdAt: "t", parts: [{ type: "text", text: "email them" }] },
      { id: "a2", role: "assistant", createdAt: "t", parts: [{ type: "text", text: "Sent." }] },
    ])
    fetchImpl.mockImplementation((url: string, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith("/agent/chat/stream")) {
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
      if (/\/agent\/conversations\/[^/]+\/messages$/.test(href)) {
        messagesCalls += 1
        return Promise.resolve(messagesGate())
      }
      return Promise.resolve(defaultResponse(href))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "email them")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    expect(await screen.findByText("Approval required")).toBeInTheDocument()
    expect(screen.getByText("Send to 3 recipients")).toBeInTheDocument()

    // A turn parked on an approval never settles either, so the mid-stream
    // history fetch — which came back with the user's message — must not be
    // rendered next to the optimistic copy still on screen. Waiting on the
    // call count first is what stops this from passing vacuously, before the
    // fetch that would cause the duplicate has even happened.
    await waitFor(() => expect(messagesCalls).toBeGreaterThan(0))
    expect(screen.getAllByText("email them")).toHaveLength(1)

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
      return Promise.resolve(defaultResponse(String(url)))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "go")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText("Partial")).toBeInTheDocument()
    })
  })

  it("keeps the typed message and the partial reply when Stop is clicked mid-stream", async () => {
    // An abort-aware stream stub: the connection delivers a partial reply and
    // then stays open (no `done` frame) until the AbortSignal fires, at which
    // point the stream errors — the same shape a real aborted fetch takes.
    fetchImpl.mockImplementation((url: string, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith("/agent/chat/stream")) {
        const enc = new TextEncoder()
        let controller: ReadableStreamDefaultController<Uint8Array>
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            controller = c
            c.enqueue(enc.encode(frame({ type: "start", conversationId: "c1", runId: "r1" })))
            c.enqueue(enc.encode(frame({ type: "text-delta", delta: "partial reply" })))
            // Deliberately never closed — simulates a still-open connection.
          },
        })
        init?.signal?.addEventListener("abort", () => {
          controller.error(new DOMException("Aborted", "AbortError"))
        })
        return Promise.resolve(new Response(stream, { status: 200 }))
      }
      return Promise.resolve(defaultResponse(href))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "go")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    await waitFor(() => {
      expect(screen.getByText("go")).toBeInTheDocument()
      expect(screen.getByText("partial reply")).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole("button", { name: "Stop" }))

    // Both must survive: the reducer's contract for a cancelled turn is that
    // partial output is kept, and the server was never asked to persist a run
    // the client just abandoned, so there is nothing to revalidate against.
    await waitFor(() => {
      expect(screen.getByText("go")).toBeInTheDocument()
      expect(screen.getByText("partial reply")).toBeInTheDocument()
    })
  })

  it("does not duplicate an interrupted turn's reply once the connection drops", async () => {
    const messagesGate = historyOnceMore(
      [
        { id: "m0", role: "user", createdAt: "t", parts: [{ type: "text", text: "earlier question" }] },
        { id: "u1", role: "user", createdAt: "t", parts: [{ type: "text", text: "go" }] },
      ],
      [
        { id: "m0", role: "user", createdAt: "t", parts: [{ type: "text", text: "earlier question" }] },
        { id: "u1", role: "user", createdAt: "t", parts: [{ type: "text", text: "go" }] },
        { id: "a1", role: "assistant", createdAt: "t", parts: [{ type: "text", text: "the full answer" }] },
      ],
    )
    fetchImpl.mockImplementation((url: string) => {
      const href = String(url)
      if (href.endsWith("/agent/chat/stream")) {
        // The connection drops mid-frame — no `done`, no `error` — after the
        // reply has fully streamed. The server "usually did finish" per the
        // review: `after` models it having persisted the run anyway.
        return Promise.resolve(
          truncatedSseResponse(
            [{ type: "start", conversationId: "c1", runId: "r1" }],
            { type: "text-delta", delta: "the full answer" },
          ),
        )
      }
      if (/\/agent\/conversations\/[^/]+\/messages$/.test(href)) return Promise.resolve(messagesGate())
      return Promise.resolve(defaultResponse(href))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "go")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    // Rendered exactly once — live, from the kept turn — never a second time
    // from a revalidate that assumed the server had already persisted it.
    await waitFor(() => {
      expect(screen.getAllByText("the full answer")).toHaveLength(1)
    })
    // And so is the user's own message, which the mid-stream fetch DID come
    // back with while `optimistic` still held the client's copy. An
    // interrupted turn never settles, so a duplicate here would never clear.
    expect(screen.getAllByText("go")).toHaveLength(1)
    // Give an incorrect second revalidate a moment to land, then confirm
    // neither count has moved — this state is permanent, not a settling race.
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getAllByText("the full answer")).toHaveLength(1)
    expect(screen.getAllByText("go")).toHaveLength(1)
  })

  it("shows an optimistic user message before the stream produces anything", async () => {
    let resolveStream!: (value: Response) => void
    const messagesGate = historyResponse([
      { id: "a1", role: "assistant", createdAt: "t", parts: [{ type: "text", text: "hi back" }] },
    ])
    fetchImpl.mockImplementation((url: string) => {
      const href = String(url)
      if (href.endsWith("/agent/chat/stream")) {
        // Never resolves until the test releases it — proves the echo is not
        // waiting on any stream output.
        return new Promise<Response>((resolve) => {
          resolveStream = resolve
        })
      }
      if (/\/agent\/conversations\/[^/]+\/messages$/.test(href)) return Promise.resolve(messagesGate())
      return Promise.resolve(defaultResponse(href))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "hello there")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    expect(await screen.findByText("hello there")).toBeInTheDocument()

    // Let the stream resolve so the turn settles cleanly before the test ends.
    resolveStream(
      sseResponse([
        { type: "start", conversationId: "c1", runId: "r1" },
        { type: "text-delta", delta: "hi back" },
        { type: "done", status: "succeeded" },
      ]),
    )
    // `waitFor`, not `findByText`: once the turn settles, the in-flight
    // bubble (id "in-flight") is swapped for the settled stored-history one
    // (id "a1") for the same text — a bare `findByText` can resolve to the
    // in-flight node a tick before the swap detaches it.
    await waitFor(() => {
      expect(screen.getByText("hi back")).toBeInTheDocument()
    })
  })

  it("revalidates the rail after a turn settles", async () => {
    let railCalls = 0
    const messagesGate = historyResponse([
      { id: "a1", role: "assistant", createdAt: "t", parts: [{ type: "text", text: "done." }] },
    ])
    fetchImpl.mockImplementation((url: string) => {
      const href = String(url)
      if (href.endsWith("/agent/chat/stream")) {
        return Promise.resolve(
          sseResponse([
            { type: "start", conversationId: "c1", runId: "r1" },
            { type: "text-delta", delta: "done." },
            { type: "done", status: "succeeded" },
          ]),
        )
      }
      if (href.includes("/agent/conversations?")) railCalls += 1
      if (/\/agent\/conversations\/[^/]+\/messages$/.test(href)) return Promise.resolve(messagesGate())
      return Promise.resolve(defaultResponse(href))
    })

    renderTerminal()
    await screen.findByText("Ask the system")
    expect(railCalls).toBe(1)

    await userEvent.type(screen.getByPlaceholderText("Ask the system…"), "status?")
    await userEvent.click(screen.getByRole("button", { name: /submit/i }))

    await screen.findByText("done.")
    // The rail's titles and counts move with every turn — a second GET must
    // follow the stream closing, not just the one on mount.
    await waitFor(() => expect(railCalls).toBe(2))
  })
})
