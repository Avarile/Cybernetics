import { beforeEach, describe, expect, it } from "vitest"
import { useTurnStore } from "./turn.store"

const s = () => useTurnStore.getState()

describe("turn.store", () => {
  beforeEach(() => s().reset())

  it("selecting a conversation drops the previous turn and optimistic rows", () => {
    s().selectConversation("c1")
    s().appendOptimistic("hi")
    s().beginTurn()
    s().selectConversation("c2")

    expect(s().activeId).toBe("c2")
    expect(s().optimistic).toHaveLength(0)
    expect(s().turn).toBeNull()
  })

  it("appends an optimistic user message with a non-colliding local id", () => {
    s().appendOptimistic("hello")
    expect(s().optimistic[0].role).toBe("user")
    expect(s().optimistic[0].id).toMatch(/^local-/)
    expect(s().optimistic[0].parts).toEqual([{ type: "text", text: "hello" }])
  })

  it("gives each optimistic message a distinct id", () => {
    // Same text both times: text length alone can't be what tells the two
    // apart, so this only passes if the id actually incorporates position —
    // a scheme that returns a constant id would pass the test above but fail
    // here, and colliding ids are exactly what a `key`-driven render breaks on.
    s().appendOptimistic("hello")
    s().appendOptimistic("hello")
    const ids = s().optimistic.map((m) => m.id)
    expect(new Set(ids).size).toBe(2)
  })

  it("learns the conversation id from the start frame", () => {
    s().beginTurn()
    s().applyEvent({ type: "start", conversationId: "c9", runId: "r1" })
    expect(s().activeId).toBe("c9")
    expect(s().turn?.status).toBe("streaming")
  })

  it("ignores events with no open turn", () => {
    s().applyEvent({ type: "text-delta", delta: "x" })
    expect(s().turn).toBeNull()
  })

  it("marks a turn cancelled", () => {
    s().beginTurn()
    s().cancelTurn()
    expect(s().turn?.status).toBe("cancelled")
  })

  it("interruptTurn marks a dropped stream but keeps its partial output", () => {
    s().beginTurn()
    s().applyEvent({ type: "start", conversationId: "c1", runId: "r1" })
    s().applyEvent({ type: "text-delta", delta: "partial" })
    s().interruptTurn()
    expect(s().turn?.status).toBe("interrupted")
    expect(s().turn?.parts).toEqual([{ type: "text", text: "partial" }])
  })

  it("clearTurn drops the turn without touching the optimistic rows", () => {
    s().appendOptimistic("hi")
    s().beginTurn()
    s().clearTurn()
    expect(s().turn).toBeNull()
    expect(s().optimistic).toHaveLength(1)
  })

  it("settle clears the turn and the optimistic rows together", () => {
    s().appendOptimistic("hi")
    s().beginTurn()
    s().settle()
    expect(s().turn).toBeNull()
    expect(s().optimistic).toHaveLength(0)
  })

  it("reset returns to a pristine store", () => {
    s().selectConversation("c1")
    s().appendOptimistic("hi")
    s().reset()
    expect({ activeId: s().activeId, optimistic: s().optimistic, turn: s().turn }).toEqual({
      activeId: null,
      optimistic: [],
      turn: null,
    })
  })
})
