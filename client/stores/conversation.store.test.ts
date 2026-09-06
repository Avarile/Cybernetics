import { beforeEach, describe, expect, it } from "vitest"
import type { SseEvent } from "@/lib/agent/types"
import {
  selectIsStreaming,
  selectPendingApproval,
  buildVisibleMessages,
  useConversationStore,
} from "./conversation.store"

const s = () => useConversationStore.getState()

const START: SseEvent = { type: "start", conversationId: "c1", runId: "r1" }

describe("conversation.store", () => {
  beforeEach(() => s().reset())

  it("starts empty and idle", () => {
    expect(s().conversations).toEqual([])
    expect(s().conversationsStatus).toBe("idle")
    expect(s().activeId).toBeNull()
    expect(s().turn).toBeNull()
  })

  it("selecting a conversation clears the previous messages and turn", () => {
    s().setMessages([
      { id: "m1", role: "user", createdAt: "t", parts: [{ type: "text", text: "old" }] },
    ])
    s().beginTurn()
    s().selectConversation("c2")

    expect(s().activeId).toBe("c2")
    expect(s().messages).toEqual([])
    expect(s().messagesStatus).toBe("loading")
    expect(s().turn).toBeNull()
  })

  it("selecting the new-chat slot goes idle rather than loading", () => {
    s().selectConversation(null)
    expect(s().messagesStatus).toBe("idle")
  })

  it("appends the user's message optimistically", () => {
    s().appendUserMessage("hello")
    expect(s().messages).toHaveLength(1)
    expect(s().messages[0].role).toBe("user")
    expect(s().messages[0].parts).toEqual([{ type: "text", text: "hello" }])
  })

  it("applyEvent is a no-op before a turn begins", () => {
    s().applyEvent(START)
    expect(s().turn).toBeNull()
  })

  it("adopts the conversation id from the start frame on a first turn", () => {
    expect(s().activeId).toBeNull()
    s().beginTurn()
    s().applyEvent(START)
    expect(s().activeId).toBe("c1")
    expect(s().turn?.runId).toBe("r1")
  })

  it("accumulates deltas into the in-flight turn", () => {
    s().beginTurn()
    for (const e of [START, { type: "text-delta", delta: "Hel" }, { type: "text-delta", delta: "lo" }] as SseEvent[]) {
      s().applyEvent(e)
    }
    expect(s().turn?.parts).toEqual([{ type: "text", text: "Hello" }])
    expect(selectIsStreaming(s())).toBe(true)
  })

  it("exposes a pending approval through its selector", () => {
    s().beginTurn()
    s().applyEvent(START)
    s().applyEvent({
      type: "approval-required",
      approvalId: "ap1",
      toolCallId: "tc1",
      toolName: "send-email",
      actionType: "send_email",
      title: "Send to 3",
      payload: {},
    })
    expect(selectPendingApproval(s())?.approvalId).toBe("ap1")
  })

  it("settleTurn folds the turn into messages and clears it", () => {
    s().appendUserMessage("hi")
    s().beginTurn()
    s().applyEvent(START)
    s().applyEvent({ type: "text-delta", delta: "there" })
    s().applyEvent({ type: "done", status: "succeeded" })
    s().settleTurn("m-assistant", "2026-09-06T00:00:00.000Z")

    expect(s().turn).toBeNull()
    expect(s().messages).toHaveLength(2)
    expect(s().messages[1]).toMatchObject({
      id: "m-assistant",
      role: "assistant",
      parts: [{ type: "text", text: "there" }],
    })
  })

  it("settleTurn leaves no message behind for a turn that produced nothing", () => {
    s().beginTurn()
    s().applyEvent({ type: "error", message: "boom" })
    s().settleTurn("m1", "t")
    expect(s().messages).toEqual([])
    expect(s().turn).toBeNull()
  })

  it("cancelTurn keeps the partial output", () => {
    s().beginTurn()
    s().applyEvent(START)
    s().applyEvent({ type: "text-delta", delta: "half" })
    s().cancelTurn()
    expect(s().turn?.status).toBe("cancelled")
    expect(s().turn?.parts).toEqual([{ type: "text", text: "half" }])
  })

  it("interruptTurn marks a dropped stream", () => {
    s().beginTurn()
    s().applyEvent(START)
    s().applyEvent({ type: "text-delta", delta: "partial" })
    s().interruptTurn()
    expect(s().turn?.status).toBe("interrupted")
    expect(s().turn?.parts).toEqual([{ type: "text", text: "partial" }])
  })

  it("buildVisibleMessages appends the in-flight turn to history", () => {
    s().appendUserMessage("q")
    s().beginTurn()
    s().applyEvent(START)
    s().applyEvent({ type: "text-delta", delta: "a" })

    const visible = buildVisibleMessages(s().messages, s().turn)
    expect(visible).toHaveLength(2)
    expect(visible[1]).toMatchObject({ id: "in-flight", role: "assistant" })
  })

  it("buildVisibleMessages hides an empty in-flight turn", () => {
    s().appendUserMessage("q")
    s().beginTurn()
    expect(buildVisibleMessages(s().messages, s().turn)).toHaveLength(1)
  })

  it("records a conversations load failure with its message", () => {
    s().setConversationsStatus("error", "unreachable")
    expect(s().conversationsStatus).toBe("error")
    expect(s().conversationsError).toBe("unreachable")
  })

  it("setConversations clears a previous error", () => {
    s().setConversationsStatus("error", "boom")
    s().setConversations([])
    expect(s().conversationsStatus).toBe("ready")
    expect(s().conversationsError).toBeNull()
  })
})
