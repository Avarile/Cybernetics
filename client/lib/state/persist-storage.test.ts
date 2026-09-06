import { beforeEach, describe, expect, it, vi } from "vitest"
import { createLegacyAwareStorage } from "./persist-storage"

interface Slice {
  token: string
}

const read = (raw: string | null): Slice | null => (raw ? { token: raw } : null)

describe("createLegacyAwareStorage", () => {
  beforeEach(() => localStorage.clear())

  it("returns null when there is nothing stored at all", () => {
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toBeNull()
  })

  it("returns the persist envelope when one exists", () => {
    localStorage.setItem("new", JSON.stringify({ state: { token: "fresh" }, version: 1 }))
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toEqual({ state: { token: "fresh" }, version: 1 })
  })

  it("upgrades a legacy payload, writes the envelope, and removes the legacy key", () => {
    localStorage.setItem("old", "legacy-token")
    const storage = createLegacyAwareStorage<Slice>({ version: 3, legacy: { key: "old", read } })

    expect(storage.getItem("new")).toEqual({ state: { token: "legacy-token" }, version: 3 })
    expect(localStorage.getItem("old")).toBeNull()
    expect(JSON.parse(localStorage.getItem("new")!)).toEqual({ state: { token: "legacy-token" }, version: 3 })
  })

  it("prefers the envelope over a legacy key that somehow still exists", () => {
    localStorage.setItem("old", "stale")
    localStorage.setItem("new", JSON.stringify({ state: { token: "fresh" }, version: 1 }))
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toEqual({ state: { token: "fresh" }, version: 1 })
  })

  it("returns null when the legacy converter rejects the payload", () => {
    localStorage.setItem("old", "")
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toBeNull()
  })

  it("survives corrupt json in the envelope slot", () => {
    localStorage.setItem("new", "{not json")
    const storage = createLegacyAwareStorage<Slice>({ version: 1 })
    expect(storage.getItem("new")).toBeNull()
  })

  it("keeps the legacy key when the envelope write fails", () => {
    localStorage.setItem("old", "legacy-token")
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError")
    })

    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })
    expect(storage.getItem("new")).toEqual({ state: { token: "legacy-token" }, version: 1 })

    setItem.mockRestore()
    // The upgrade failed, so the ONLY surviving copy must still be there.
    expect(localStorage.getItem("old")).toBe("legacy-token")
  })

  it("falls back to the legacy payload when the envelope slot is corrupt", () => {
    localStorage.setItem("new", "{not json")
    localStorage.setItem("old", "legacy-token")
    const storage = createLegacyAwareStorage<Slice>({ version: 1, legacy: { key: "old", read } })

    expect(storage.getItem("new")).toEqual({ state: { token: "legacy-token" }, version: 1 })
    expect(localStorage.getItem("old")).toBeNull()
  })

  it("round-trips setItem and removeItem", () => {
    const storage = createLegacyAwareStorage<Slice>({ version: 1 })
    storage.setItem("new", { state: { token: "x" }, version: 1 })
    expect(storage.getItem("new")).toEqual({ state: { token: "x" }, version: 1 })
    storage.removeItem("new")
    expect(storage.getItem("new")).toBeNull()
  })
})
