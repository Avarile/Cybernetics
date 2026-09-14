import { describe, expect, it } from "vitest"
import { rowsOf, type Paginated } from "./types"

interface Row {
  id: string
}

const A: Row[] = [{ id: "a" }]
const B: Row[] = [{ id: "b" }]

/**
 * One test per envelope spelling this API actually uses.
 *
 * Every unit fixture in Phase 4 used `data`, so no test would ever have caught
 * `/files` returning `items` — the table read "49 rows" from `total` while
 * rendering the empty state. `/finance/budgets` returning `rows` is the same
 * bug waiting in a second place, which is why each spelling is pinned here
 * rather than trusted to the domain tests that happen to exercise it.
 */
describe("rowsOf", () => {
  it("reads `data`", () => {
    expect(rowsOf({ data: A, total: 1, page: 1, limit: 20 })).toBe(A)
  })

  it("reads `items` — /files", () => {
    expect(rowsOf({ items: A, total: 1, page: 1, limit: 20 })).toBe(A)
  })

  it("reads `rows` — /finance/budgets", () => {
    // No page/limit in this envelope at all; the caller holds those.
    expect(rowsOf({ rows: A, total: 1 })).toBe(A)
  })

  it("returns an empty array for an envelope with none of them", () => {
    expect(rowsOf({ total: 49, page: 1, limit: 20 })).toEqual([])
  })

  it("returns an empty array for null and undefined", () => {
    expect(rowsOf(null)).toEqual([])
    expect(rowsOf(undefined)).toEqual([])
  })

  it("prefers `data` when an envelope carries more than one", () => {
    // Not expected from any endpoint, but the precedence must be deterministic
    // rather than dependent on key order.
    const both: Paginated<Row> = { data: A, items: B, rows: B, total: 1 }
    expect(rowsOf(both)).toBe(A)
  })

  it("treats an explicitly empty `data` as empty, not as absent", () => {
    // `?? ` on an empty array must not fall through to `items`.
    expect(rowsOf({ data: [], items: A, total: 0 })).toEqual([])
  })
})
