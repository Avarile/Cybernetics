import { describe, expect, it } from "vitest"
import { formatAmount, formatDuration } from "./cells"

/**
 * Money formatting is the one cell worth pinning down on its own.
 *
 * Amounts are `numeric(20, 4)` decimal strings and reach the client as
 * strings for a reason the schema states outright — "never a float". A
 * Number() round-trip is silently lossy past 15 significant digits, and a
 * ledger wrong in its low digits is worse than one that will not render.
 */
describe("formatAmount", () => {
  it("groups thousands and shows two places", () => {
    expect(formatAmount("1234.5000", "en-US")).toBe("1,234.50")
  })

  it("pads a missing fraction", () => {
    expect(formatAmount("20", "en-US")).toBe("20.00")
    expect(formatAmount("20.5", "en-US")).toBe("20.50")
  })

  it("truncates the two extra places the column carries for rounding", () => {
    expect(formatAmount("10.9999", "en-US")).toBe("10.99")
  })

  it("keeps every digit of a 16-digit amount", () => {
    // Number("12345678901234.5678") === 12345678901234.568 — the exact case
    // the string transport exists to avoid.
    expect(formatAmount("12345678901234.5678", "en-US")).toBe("12,345,678,901,234.56")
  })

  it("handles a negative amount", () => {
    expect(formatAmount("-99.9900", "en-US")).toBe("-99.99")
  })

  it("handles zero", () => {
    expect(formatAmount("0", "en-US")).toBe("0.00")
    expect(formatAmount("0.0000", "en-US")).toBe("0.00")
  })

  it("passes a non-numeric string through rather than inventing a number", () => {
    expect(formatAmount("n/a", "en-US")).toBe("n/a.00")
  })
})

describe("formatDuration", () => {
  it.each([
    [150, "2h 30m"],
    [60, "1h"],
    [45, "45m"],
    [0, "0m"],
    [1440, "24h"],
  ])("%i minutes → %s", (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected)
  })

  it("renders a dash for null", () => {
    expect(formatDuration(null)).toBe("—")
  })
})
