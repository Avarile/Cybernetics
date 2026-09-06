import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/api/errors"
import { streamChat } from "./stream"
import type { SseEvent } from "./types"

function frame(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** A Response whose body streams the given string pieces, in order. */
function streamingResponse(pieces: string[], init: ResponseInit = {}) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p))
      controller.close()
    },
  })
  return new Response(body, { status: 200, ...init })
}

/** A body that emits, then hangs until the signal aborts. */
function hangingResponse(pieces: string[], signal: AbortSignal) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p))
      signal.addEventListener("abort", () => {
        controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }))
      })
    },
  })
  return new Response(body, { status: 200 })
}

const EVENTS: SseEvent[] = [
  { type: "start", conversationId: "c1", runId: "r1" },
  { type: "text-delta", delta: "Hello" },
  { type: "done", status: "succeeded" },
]

describe("streamChat", () => {
  const fetchImpl = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", fetchImpl)
  })

  function run(over: Partial<Parameters<typeof streamChat>[0]> = {}) {
    const seen: SseEvent[] = []
    const promise = streamChat({
      baseUrl: "https://api.test",
      getAccessToken: () => "access-1",
      body: { message: "hi" },
      onEvent: (e) => seen.push(e),
      ...over,
    })
    return { seen, promise }
  }

  it("posts to /agent/chat/stream with the bearer token and no credentials", async () => {
    fetchImpl.mockResolvedValueOnce(streamingResponse(EVENTS.map(frame)))
    await run().promise

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://api.test/agent/chat/stream")
    expect(init.method).toBe("POST")
    expect(init.credentials).toBe("omit")
    expect((init.headers as Headers).get("authorization")).toBe("Bearer access-1")
    expect((init.headers as Headers).get("accept")).toBe("text/event-stream")
    expect(JSON.parse(init.body)).toEqual({ message: "hi" })
  })

  it("emits every event in order", async () => {
    fetchImpl.mockResolvedValueOnce(streamingResponse(EVENTS.map(frame)))
    const { seen, promise } = run()
    const result = await promise
    expect(seen).toEqual(EVENTS)
    expect(result).toEqual({ truncated: false, aborted: false })
  })

  it("reassembles an event split across network chunks", async () => {
    const whole = EVENTS.map(frame).join("")
    // Cut in the middle of the text-delta payload.
    const cut = whole.indexOf("Hello") + 2
    fetchImpl.mockResolvedValueOnce(
      streamingResponse([whole.slice(0, cut), whole.slice(cut)]),
    )
    const { seen, promise } = run()
    await promise
    expect(seen).toEqual(EVENTS)
  })

  it("reassembles a multi-byte character split across chunks", async () => {
    const ev: SseEvent = { type: "text-delta", delta: "café — ok" }
    const bytes = new TextEncoder().encode(frame(ev))
    // Split inside the em-dash's UTF-8 sequence.
    const mid = bytes.indexOf(0xe2)
    expect(mid).toBeGreaterThan(0)

    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, mid + 1))
        c.enqueue(bytes.slice(mid + 1))
        c.close()
      },
    })
    fetchImpl.mockResolvedValueOnce(new Response(body, { status: 200 }))

    const { seen, promise } = run()
    await promise
    expect(seen).toEqual([ev])
  })

  it("sends a resume body for an approval decision", async () => {
    fetchImpl.mockResolvedValueOnce(streamingResponse(EVENTS.map(frame)))
    await run({ body: { resume: { approvalId: "ap1", approved: true } } }).promise
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      resume: { approvalId: "ap1", approved: true },
    })
  })

  it("omits the bearer header when there is no token", async () => {
    fetchImpl.mockResolvedValueOnce(streamingResponse(EVENTS.map(frame)))
    await run({ getAccessToken: () => null }).promise
    expect((fetchImpl.mock.calls[0][1].headers as Headers).has("authorization")).toBe(false)
  })

  it("throws a typed ApiError for a pre-stream failure", async () => {
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: "Provide exactly one of `message` or `resume`",
            statusCode: 422,
            details: null,
            correlationId: 7,
            timestamp: "t",
            path: "/agent/chat/stream",
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    )
    await expect(run().promise).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      statusCode: 422,
    })
  })

  it("does NOT retry a 401 — refreshing here would race the ApiClient latch", async () => {
    fetchImpl.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "AUTH_TOKEN_EXPIRED", message: "expired", statusCode: 401 },
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    )
    await expect(run().promise).rejects.toBeInstanceOf(ApiError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("falls back cleanly when the error body is not JSON", async () => {
    fetchImpl.mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }))
    await expect(run().promise).rejects.toMatchObject({ code: "UNKNOWN", statusCode: 502 })
  })

  it("reports truncated when the stream is cut mid-frame", async () => {
    fetchImpl.mockResolvedValueOnce(
      streamingResponse([
        frame({ type: "start", conversationId: "c1", runId: "r1" }) +
          'data: {"type":"text-delta","del',
      ]),
    )
    const { seen, promise } = run()
    const result = await promise
    expect(result.truncated).toBe(true)
    // the complete frame before the cut still arrived
    expect(seen.map((e) => e.type)).toEqual(["start"])
  })

  it("recovers a final frame that never got its blank line", async () => {
    fetchImpl.mockResolvedValueOnce(
      streamingResponse([
        frame({ type: "start", conversationId: "c1", runId: "r1" }) +
          'data: {"type":"done","status":"succeeded"}',
      ]),
    )
    const { seen, promise } = run()
    await promise
    expect(seen.map((e) => e.type)).toEqual(["start", "done"])
  })

  it("resolves as aborted when the caller stops the turn", async () => {
    const controller = new AbortController()
    fetchImpl.mockImplementationOnce(() =>
      Promise.resolve(
        hangingResponse(
          [frame({ type: "start", conversationId: "c1", runId: "r1" })],
          controller.signal,
        ),
      ),
    )
    const { seen, promise } = run({ signal: controller.signal })
    // let the first frame land, then stop
    await Promise.resolve()
    controller.abort()

    const result = await promise
    expect(result.aborted).toBe(true)
    expect(seen.map((e) => e.type)).toContain("start")
  })

  it("resolves as aborted when fetch itself rejects with AbortError", async () => {
    const controller = new AbortController()
    controller.abort()
    fetchImpl.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    )
    await expect(run({ signal: controller.signal }).promise).resolves.toEqual({
      truncated: false,
      aborted: true,
    })
  })

  it("wraps a network failure as an ApiError rather than leaking a TypeError", async () => {
    fetchImpl.mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await expect(run().promise).rejects.toMatchObject({ code: "NETWORK", statusCode: 0 })
  })

  it("throws when the response carries no body", async () => {
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 200 }))
    await expect(run().promise).rejects.toMatchObject({ code: "NETWORK" })
  })
})
