import { describe, expect, it } from "vitest"
import { applyCollectionQuery } from "./collection-query"
import { initialQuery, type TableQuery } from "./query"
import type { DomainTableConfig } from "./types"

interface Row {
  id: string
  name: string
  kind: string
  balance: string | null
}

const CONFIG: Pick<DomainTableConfig<Row>, "columns" | "tabs"> = {
  columns: [
    { key: "name", header: "Name", cell: (r) => r.name },
    { key: "kind", header: "Kind", cell: (r) => r.kind },
    { key: "balance", header: "Balance", cell: (r) => r.balance },
  ],
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "bank", label: "Bank", query: { kind: "bank" } },
  ],
}

const ROWS: Row[] = [
  { id: "1", name: "Current", kind: "bank", balance: "100.0000" },
  { id: "2", name: "Savings", kind: "bank", balance: "9000.0000" },
  { id: "3", name: "Petty cash", kind: "cash", balance: "20.0000" },
  { id: "4", name: "Amex", kind: "credit_card", balance: null },
]

const q = (over: Partial<TableQuery> = {}): TableQuery => ({
  ...initialQuery(CONFIG.tabs),
  ...over,
})

const names = (r: Row[]) => r.map((x) => x.name)

describe("applyCollectionQuery", () => {
  it("returns the page and the filtered total, not the slice length", () => {
    const out = applyCollectionQuery(ROWS, q({ limit: 2 }), CONFIG)
    expect(out.rows).toHaveLength(2)
    // The pager divides by this; counting the slice would read "2 rows" forever.
    expect(out.total).toBe(4)
  })

  it("applies the active tab's query params", () => {
    const out = applyCollectionQuery(ROWS, q({ tab: "bank" }), CONFIG)
    expect(names(out.rows)).toEqual(["Current", "Savings"])
    expect(out.total).toBe(2)
  })

  it("lets an explicit filter beat the tab on the same key", () => {
    // Same precedence buildListUrl gives paged endpoints.
    const out = applyCollectionQuery(ROWS, q({ tab: "bank", filters: { kind: "cash" } }), CONFIG)
    expect(names(out.rows)).toEqual(["Petty cash"])
  })

  it("ignores an empty filter value rather than matching empty fields", () => {
    const out = applyCollectionQuery(ROWS, q({ filters: { kind: "" } }), CONFIG)
    expect(out.total).toBe(4)
  })

  it("never matches a row whose filtered field is absent", () => {
    const out = applyCollectionQuery(ROWS, q({ filters: { nope: "x" } }), CONFIG)
    expect(out.total).toBe(0)
  })

  it("searches case-insensitively across the columns' fields", () => {
    expect(names(applyCollectionQuery(ROWS, q({ search: "SAV" }), CONFIG).rows)).toEqual([
      "Savings",
    ])
    expect(names(applyCollectionQuery(ROWS, q({ search: "card" }), CONFIG).rows)).toEqual([
      "Amex",
    ])
  })

  it("trims the search term", () => {
    expect(applyCollectionQuery(ROWS, q({ search: "   " }), CONFIG).total).toBe(4)
    expect(applyCollectionQuery(ROWS, q({ search: "  Amex " }), CONFIG).total).toBe(1)
  })

  it("sorts numerically when both sides are numbers, not lexically", () => {
    // "9000" < "100" as strings. A balance column sorted lexically is worse
    // than unsorted, because it looks ordered.
    const out = applyCollectionQuery(
      ROWS,
      q({ sort: { key: "balance", dir: "asc" } }),
      CONFIG,
    )
    expect(names(out.rows)).toEqual(["Petty cash", "Current", "Savings", "Amex"])
  })

  it("keeps blanks last in both directions", () => {
    const asc = applyCollectionQuery(ROWS, q({ sort: { key: "balance", dir: "asc" } }), CONFIG)
    const desc = applyCollectionQuery(ROWS, q({ sort: { key: "balance", dir: "desc" } }), CONFIG)
    expect(names(asc.rows).at(-1)).toBe("Amex")
    expect(names(desc.rows).at(-1)).toBe("Amex")
  })

  it("sorts strings by locale order", () => {
    const out = applyCollectionQuery(ROWS, q({ sort: { key: "name", dir: "asc" } }), CONFIG)
    expect(names(out.rows)).toEqual(["Amex", "Current", "Petty cash", "Savings"])
  })

  it("does not mutate the input array", () => {
    const before = [...ROWS]
    applyCollectionQuery(ROWS, q({ sort: { key: "name", dir: "desc" } }), CONFIG)
    expect(ROWS).toEqual(before)
  })

  it("returns an empty page past the end rather than the last page", () => {
    // clampPage corrects the page at the call site; correcting it here too
    // would hide the case where it did not run.
    const out = applyCollectionQuery(ROWS, q({ page: 9, limit: 2 }), CONFIG)
    expect(out.rows).toEqual([])
    expect(out.total).toBe(4)
  })

  it("filters before paging, so page 1 is the first MATCHING rows", () => {
    const out = applyCollectionQuery(ROWS, q({ tab: "bank", limit: 1 }), CONFIG)
    expect(names(out.rows)).toEqual(["Current"])
    expect(out.total).toBe(2)
  })
})
