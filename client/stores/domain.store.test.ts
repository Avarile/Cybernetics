import { beforeEach, describe, expect, it } from "vitest"
import { resolveHealth, useDomainStore } from "./domain.store"

const s = () => useDomainStore.getState()

describe("resolveHealth", () => {
  it("reports unknown before any count has landed", () => {
    expect(resolveHealth({ count: null })).toBe("unknown")
  })

  it("reports nominal for a reachable domain with nothing pending", () => {
    expect(resolveHealth({ count: 0 })).toBe("nominal")
    expect(resolveHealth({ count: 412 })).toBe("nominal")
  })

  it("reports active while work is in flight", () => {
    expect(resolveHealth({ count: 3, busy: true })).toBe("active")
  })

  it("reports attention for pending approvals or at-risk budgets", () => {
    expect(resolveHealth({ count: 3, needsAttention: true })).toBe("attention")
  })

  it("ranks error above every other signal", () => {
    expect(
      resolveHealth({ count: 3, failed: true, busy: true, needsAttention: true }),
    ).toBe("error")
  })

  it("ranks attention above active", () => {
    expect(resolveHealth({ count: 3, busy: true, needsAttention: true })).toBe("attention")
  })

  it("treats a zero count as reachable, not missing", () => {
    // The distinction that matters: 0 rows is nominal, no answer is unknown.
    expect(resolveHealth({ count: 0 })).toBe("nominal")
    expect(resolveHealth({ count: null })).toBe("unknown")
  })
})

describe("domain.store", () => {
  beforeEach(() => s().reset())

  it("reports unknown for a domain it has never seen", () => {
    expect(s().healthFor("contacts")).toBe("unknown")
  })

  it("records and reads back a domain's health", () => {
    s().setDomain("contacts", { count: 12, health: "nominal" })
    expect(s().healthFor("contacts")).toBe("nominal")
    expect(s().byKey.contacts.count).toBe(12)
  })

  it("setMany merges rather than replacing the map", () => {
    s().setDomain("contacts", { count: 1, health: "nominal" })
    s().setMany({ files: { count: 2, health: "active" } })
    expect(s().healthFor("contacts")).toBe("nominal")
    expect(s().healthFor("files")).toBe("active")
  })

  it("keeps an error message for a failed domain", () => {
    s().setMany({ mailbox: { count: null, health: "error", error: "unreachable" } })
    expect(s().byKey.mailbox.error).toBe("unreachable")
    expect(s().healthFor("mailbox")).toBe("error")
  })

  it("reset clears everything", () => {
    s().setDomain("contacts", { count: 1, health: "nominal" })
    s().reset()
    expect(s().byKey).toEqual({})
    expect(s().healthFor("contacts")).toBe("unknown")
  })
})
