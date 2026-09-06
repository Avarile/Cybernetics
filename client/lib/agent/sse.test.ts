import { describe, expect, it } from "vitest"
import { SseParser, parseFrame } from "./sse"
import type { SseEvent } from "./types"

/** Exactly what `sseFrame()` in chunk-to-sse.ts writes. */
function frame(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

describe("parseFrame", () => {
  it("reads a single data line", () => {
    expect(parseFrame('data: {"type":"text-delta","delta":"hi"}')).toEqual({
      type: "text-delta",
      delta: "hi",
    })
  })

  it("ignores comment keep-alives", () => {
    expect(parseFrame(":heartbeat")).toBeNull()
  })

  it("ignores a frame with no data field", () => {
    expect(parseFrame("event: ping\nid: 3")).toBeNull()
  })

  it("returns null for malformed JSON rather than throwing", () => {
    expect(parseFrame("data: {not json")).toBeNull()
  })

  it("returns null for JSON without a string type", () => {
    expect(parseFrame('data: {"delta":"x"}')).toBeNull()
    expect(parseFrame("data: 42")).toBeNull()
    expect(parseFrame("data: null")).toBeNull()
  })

  it("joins multi-line data fields per the SSE grammar", () => {
    const ev = parseFrame('data: {"type":"text-delta",\ndata: "delta":"hi"}')
    expect(ev).toEqual({ type: "text-delta", delta: "hi" })
  })
})

describe("SseParser", () => {
  it("yields one event per complete frame", () => {
    const p = new SseParser()
    const out = p.push(
      frame({ type: "start", conversationId: "c1", runId: "r1" }) +
        frame({ type: "text-delta", delta: "a" }),
    )
    expect(out.map((e) => e.type)).toEqual(["start", "text-delta"])
  })

  it("holds a partial frame until the rest arrives", () => {
    const p = new SseParser()
    const whole = frame({ type: "text-delta", delta: "hello" })

    // Split mid-JSON — the case that actually happens on the wire.
    const cut = whole.indexOf("hel") + 2
    expect(p.push(whole.slice(0, cut))).toEqual([])
    expect(p.hasPartial).toBe(true)

    expect(p.push(whole.slice(cut))).toEqual([{ type: "text-delta", delta: "hello" }])
    expect(p.hasPartial).toBe(false)
  })

  it("reassembles a frame split one character at a time", () => {
    const p = new SseParser()
    const whole = frame({ type: "text-delta", delta: "streamed" })
    const seen: SseEvent[] = []
    for (const ch of whole) seen.push(...p.push(ch))
    expect(seen).toEqual([{ type: "text-delta", delta: "streamed" }])
  })

  it("handles several frames arriving in one chunk", () => {
    const p = new SseParser()
    const chunk = ["a", "b", "c"]
      .map((d) => frame({ type: "text-delta", delta: d }))
      .join("")
    expect(p.push(chunk).map((e) => (e as { delta: string }).delta)).toEqual([
      "a",
      "b",
      "c",
    ])
  })

  it("handles a chunk boundary that lands exactly on the separator", () => {
    const p = new SseParser()
    const whole = frame({ type: "done", status: "succeeded" })
    const cut = whole.length - 1 // splits "\n\n"
    expect(p.push(whole.slice(0, cut))).toEqual([])
    expect(p.push(whole.slice(cut))).toEqual([{ type: "done", status: "succeeded" }])
  })

  it("accepts CRLF separators from a rewriting proxy", () => {
    const p = new SseParser()
    const out = p.push('data: {"type":"text-delta","delta":"x"}\r\n\r\n')
    expect(out).toEqual([{ type: "text-delta", delta: "x" }])
  })

  it("skips an unparseable frame without dropping the ones around it", () => {
    const p = new SseParser()
    const out = p.push(
      frame({ type: "text-delta", delta: "before" }) +
        "data: {broken\n\n" +
        frame({ type: "text-delta", delta: "after" }),
    )
    expect(out.map((e) => (e as { delta: string }).delta)).toEqual(["before", "after"])
  })

  it("passes through an unknown event type rather than failing", () => {
    // Forward compatibility: a newer backend adding a variant must not take the
    // stream down. The reducer decides what to ignore.
    const p = new SseParser()
    const out = p.push('data: {"type":"some-future-event","x":1}\n\n')
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe("some-future-event")
  })

  it("flush() recovers a frame that never got its blank line", () => {
    const p = new SseParser()
    expect(p.push('data: {"type":"done","status":"failed"}')).toEqual([])
    expect(p.flush()).toEqual([{ type: "done", status: "failed" }])
  })

  it("flush() is empty for a cleanly terminated stream", () => {
    const p = new SseParser()
    p.push(frame({ type: "done", status: "succeeded" }))
    expect(p.flush()).toEqual([])
  })

  it("flush() clears the buffer so a reused parser starts clean", () => {
    const p = new SseParser()
    p.push("data: {partial")
    p.flush()
    expect(p.hasPartial).toBe(false)
  })

  it("carries every variant of the real union intact", () => {
    const events: SseEvent[] = [
      { type: "start", conversationId: "c1", runId: "r1" },
      { type: "text-delta", delta: "t" },
      { type: "reasoning-delta", delta: "r" },
      { type: "tool-input", toolCallId: "tc1", toolName: "send-email", args: { to: "a" } },
      {
        type: "tool-output",
        toolCallId: "tc1",
        toolName: "send-email",
        result: { ok: true },
        isError: false,
      },
      {
        type: "approval-required",
        approvalId: "ap1",
        toolCallId: "tc1",
        toolName: "send-email",
        actionType: "send_email",
        title: "Send to 3 recipients",
        payload: { to: ["a", "b", "c"] },
      },
      { type: "error", message: "boom" },
      { type: "done", status: "awaiting_approval" },
    ]
    const p = new SseParser()
    expect(p.push(events.map(frame).join(""))).toEqual(events)
  })
})
