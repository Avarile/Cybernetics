import { describe, expect, it } from "vitest"
import { hasPrefix } from "./match"

describe("hasPrefix", () => {
  it("matches an exact key", () => {
    expect(hasPrefix(["list", "/contacts", "/contacts?page=1"], ["list", "/contacts", "/contacts?page=1"])).toBe(true)
  })

  it("matches a shorter prefix", () => {
    expect(hasPrefix(["list", "/contacts", "/contacts?page=2"], ["list", "/contacts"])).toBe(true)
  })

  it("rejects a different domain under the same head", () => {
    expect(hasPrefix(["list", "/files", "/files?page=1"], ["list", "/contacts"])).toBe(false)
  })

  it("rejects a prefix longer than the key", () => {
    expect(hasPrefix(["list"], ["list", "/contacts"])).toBe(false)
  })

  it("rejects non-array keys, which SWR also stores", () => {
    expect(hasPrefix("session", ["session"])).toBe(false)
    expect(hasPrefix(null, ["session"])).toBe(false)
  })

  it("matches an empty prefix against any array key", () => {
    expect(hasPrefix(["anything"], [])).toBe(true)
  })
})
