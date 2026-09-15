import { describe, expect, it } from "vitest"
import { initialQuery } from "@/components/data-table/query"
import { keys } from "./keys"
import { hasPrefix } from "./match"

describe("keys", () => {
  it("gives the session a stable single-segment key", () => {
    expect(keys.session()).toEqual(["session"])
  })

  it("carries the fetchable url in the conversations key", () => {
    expect(keys.conversations()).toEqual([
      "conversations",
      "/agent/conversations?page=1&limit=20&status=active",
    ])
  })

  it("keys each shelf separately so switching cannot read the other's cache", () => {
    expect(keys.conversations(1, 20, "archived")).not.toEqual(
      keys.conversations(1, 20, "active"),
    )
  })

  it("keeps the conversations prefix stable across shelves and window sizes", () => {
    // `invalidate(scopes.conversations())` matches on this first element, so a
    // rename has to reach every variant through it.
    for (const key of [
      keys.conversations(),
      keys.conversations(1, 60, "archived"),
      keys.conversations(1, 100, "all"),
    ]) {
      expect(key[0]).toBe("conversations")
    }
  })

  it("carries the fetchable url in the agents key", () => {
    expect(keys.agents()).toEqual(["agents", "/agent/agents"])
  })

  it("keys messages by conversation id", () => {
    expect(keys.messages("c1")).toEqual(["conversation", "c1", "messages"])
  })

  it("produces an identical key for an identical query", () => {
    const q = initialQuery()
    expect(keys.list("/contacts", q)).toEqual(keys.list("/contacts", { ...q }))
  })

  it("produces different keys for different pages", () => {
    const q = initialQuery()
    expect(keys.list("/contacts", q)).not.toEqual(keys.list("/contacts", { ...q, page: 2 }))
  })

  it("shares a prefix across every page of one domain", () => {
    const q = initialQuery()
    expect(hasPrefix(keys.list("/contacts", { ...q, page: 7 }), ["list", "/contacts"])).toBe(true)
  })

  it("keeps domains apart under the list prefix", () => {
    const q = initialQuery()
    expect(hasPrefix(keys.list("/files", q), ["list", "/contacts"])).toBe(false)
  })

  it("keys a record by endpoint and id", () => {
    expect(keys.record("/contacts", "abc")).toEqual(["record", "/contacts", "abc"])
  })
})
