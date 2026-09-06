import { describe, expect, it } from "vitest"
import {
  initialTurn,
  markCancelled,
  markInterrupted,
  reduceAll,
  reduceTurn,
  turnToMessage,
} from "./reducer"
import type { SseEvent } from "./types"

const START: SseEvent = { type: "start", conversationId: "c1", runId: "r1" }

function text(delta: string): SseEvent {
  return { type: "text-delta", delta }
}
function reasoning(delta: string): SseEvent {
  return { type: "reasoning-delta", delta }
}

describe("reduceTurn", () => {
  it("binds the conversation and run on start", () => {
    const s = reduceTurn(initialTurn(), START)
    expect(s.conversationId).toBe("c1")
    expect(s.runId).toBe("r1")
    expect(s.status).toBe("streaming")
  })

  it("adopts the conversation id a first turn did not have", () => {
    const s = reduceTurn(initialTurn(null), START)
    expect(s.conversationId).toBe("c1")
  })

  it("accumulates text deltas into one part", () => {
    const s = reduceAll(initialTurn(), [START, text("Hel"), text("lo "), text("world")])
    expect(s.parts).toEqual([{ type: "text", text: "Hello world" }])
  })

  it("accumulates reasoning separately from text", () => {
    const s = reduceAll(initialTurn(), [START, reasoning("think"), text("say")])
    expect(s.parts).toEqual([
      { type: "reasoning", text: "think" },
      { type: "text", text: "say" },
    ])
  })

  it("opens a new block when the kind switches back", () => {
    // Interleaved reasoning must not merge into one run-on paragraph.
    const s = reduceAll(initialTurn(), [
      START,
      text("a"),
      reasoning("r"),
      text("b"),
    ])
    expect(s.parts.map((p) => [p.type, (p as { text: string }).text])).toEqual([
      ["text", "a"],
      ["reasoning", "r"],
      ["text", "b"],
    ])
  })

  it("opens a running tool part on tool-input", () => {
    const s = reduceAll(initialTurn(), [
      START,
      { type: "tool-input", toolCallId: "tc1", toolName: "search", args: { q: "x" } },
    ])
    expect(s.parts).toEqual([
      {
        type: "tool",
        toolCallId: "tc1",
        toolName: "search",
        state: "input-available",
        input: { q: "x" },
      },
    ])
  })

  it("resolves a tool by id, keeping its input", () => {
    const s = reduceAll(initialTurn(), [
      START,
      { type: "tool-input", toolCallId: "tc1", toolName: "search", args: { q: "x" } },
      {
        type: "tool-output",
        toolCallId: "tc1",
        toolName: "search",
        result: { hits: 2 },
        isError: false,
      },
    ])
    expect(s.parts).toHaveLength(1)
    expect(s.parts[0]).toMatchObject({
      state: "output-available",
      input: { q: "x" },
      output: { hits: 2 },
    })
  })

  it("resolves the right tool when two overlap", () => {
    // Tool calls interleave; matching by position instead of id would resolve
    // the wrong one.
    const s = reduceAll(initialTurn(), [
      START,
      { type: "tool-input", toolCallId: "a", toolName: "one", args: 1 },
      { type: "tool-input", toolCallId: "b", toolName: "two", args: 2 },
      { type: "tool-output", toolCallId: "a", toolName: "one", result: "A", isError: false },
    ])
    expect(s.parts).toHaveLength(2)
    expect(s.parts[0]).toMatchObject({ toolCallId: "a", state: "output-available", output: "A" })
    expect(s.parts[1]).toMatchObject({ toolCallId: "b", state: "input-available" })
  })

  it("marks an errored tool and keeps the message", () => {
    const s = reduceAll(initialTurn(), [
      START,
      { type: "tool-input", toolCallId: "tc1", toolName: "send-email", args: {} },
      {
        type: "tool-output",
        toolCallId: "tc1",
        toolName: "send-email",
        result: "smtp refused",
        isError: true,
      },
    ])
    expect(s.parts[0]).toMatchObject({ state: "output-error", errorText: "smtp refused" })
  })

  it("renders an orphan tool-output rather than dropping it", () => {
    const s = reduceAll(initialTurn(), [
      START,
      { type: "tool-output", toolCallId: "ghost", toolName: "x", result: 1, isError: false },
    ])
    expect(s.parts).toHaveLength(1)
    expect(s.parts[0]).toMatchObject({ toolCallId: "ghost", state: "output-available" })
  })

  it("records an approval and keeps the turn open", () => {
    const s = reduceAll(initialTurn(), [
      START,
      text("I'll email them. "),
      {
        type: "approval-required",
        approvalId: "ap1",
        toolCallId: "tc1",
        toolName: "send-email",
        actionType: "send_email",
        title: "Send to 3 recipients",
        payload: { to: ["a", "b", "c"] },
      },
      { type: "done", status: "awaiting_approval" },
    ])
    expect(s.approval).toMatchObject({ approvalId: "ap1", actionType: "send_email" })
    expect(s.status).toBe("awaiting_approval")
    // partial text is preserved alongside the pending decision
    expect(s.parts[0]).toEqual({ type: "text", text: "I'll email them. " })
  })

  it("carries an error frame into a failed status", () => {
    const s = reduceAll(initialTurn(), [START, text("partial"), { type: "error", message: "boom" }])
    expect(s.status).toBe("failed")
    expect(s.error).toBe("boom")
    expect(s.parts[0]).toEqual({ type: "text", text: "partial" })
  })

  it("maps every done status through unchanged", () => {
    for (const status of ["succeeded", "awaiting_approval", "cancelled", "failed"] as const) {
      expect(reduceAll(initialTurn(), [START, { type: "done", status }]).status).toBe(status)
    }
  })

  it("ignores an unknown event type instead of throwing", () => {
    const weird = { type: "some-future-event", x: 1 } as unknown as SseEvent
    const before = reduceAll(initialTurn(), [START, text("a")])
    expect(reduceTurn(before, weird)).toEqual(before)
  })

  it("is immutable — the input state is never mutated", () => {
    const before = reduceAll(initialTurn(), [START, text("a")])
    const snapshot = JSON.parse(JSON.stringify(before))
    reduceTurn(before, text("b"))
    expect(before).toEqual(snapshot)
  })

  it("survives a delta arriving after done", () => {
    // Shouldn't happen, but a late frame must not corrupt the transcript.
    const s = reduceAll(initialTurn(), [
      START,
      text("a"),
      { type: "done", status: "succeeded" },
      text("b"),
    ])
    expect((s.parts[0] as { text: string }).text).toBe("ab")
    expect(s.status).toBe("streaming")
  })
})

describe("terminal markers", () => {
  it("markInterrupted only applies to a streaming turn", () => {
    const streaming = reduceAll(initialTurn(), [START, text("a")])
    expect(markInterrupted(streaming).status).toBe("interrupted")

    const done = reduceAll(initialTurn(), [START, { type: "done", status: "succeeded" }])
    expect(markInterrupted(done).status).toBe("succeeded")
  })

  it("markInterrupted keeps the partial output", () => {
    const s = markInterrupted(reduceAll(initialTurn(), [START, text("half a sen")]))
    expect(s.parts[0]).toEqual({ type: "text", text: "half a sen" })
    expect(s.error).toMatch(/unexpectedly/)
  })

  it("markCancelled keeps partial output and does not set an error", () => {
    const s = markCancelled(reduceAll(initialTurn(), [START, text("stopped here")]))
    expect(s.status).toBe("cancelled")
    expect(s.error).toBeNull()
    expect(s.parts[0]).toEqual({ type: "text", text: "stopped here" })
  })
})

describe("turnToMessage", () => {
  it("produces a history-shaped assistant message", () => {
    const s = reduceAll(initialTurn(), [START, text("done")])
    expect(turnToMessage(s, "m1", "2026-09-06T00:00:00.000Z")).toEqual({
      id: "m1",
      role: "assistant",
      createdAt: "2026-09-06T00:00:00.000Z",
      parts: [{ type: "text", text: "done" }],
    })
  })
})
