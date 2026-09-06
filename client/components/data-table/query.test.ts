import { describe, expect, it } from "vitest"
import {
  DEFAULT_LIMIT,
  buildListUrl,
  clampPage,
  initialQuery,
  pageCount,
  type TableQuery,
} from "./query"
import type { TabSpec } from "./types"

const TABS: TabSpec[] = [
  { value: "all", label: "All", query: {} },
  { value: "active", label: "Active", query: { status: "active" } },
]

function q(over: Partial<TableQuery> = {}): TableQuery {
  return { page: 1, limit: DEFAULT_LIMIT, filters: {}, ...over }
}

/** Parses the query string back into a plain object for order-free assertions. */
function paramsOf(url: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(url.split("?")[1]))
}

describe("buildListUrl", () => {
  it("always sends page and limit", () => {
    expect(paramsOf(buildListUrl("/contacts", q()))).toEqual({
      page: "1",
      limit: "20",
    })
  })

  it("keeps the endpoint path intact", () => {
    expect(buildListUrl("/mailbox/messages", q()).startsWith("/mailbox/messages?")).toBe(true)
  })

  it("sends page 1-based, matching the API", () => {
    // The API's zod schema is `page: positive().default(1)`; a 0-based index
    // would silently 422 or return the wrong page.
    expect(paramsOf(buildListUrl("/contacts", q({ page: 3 }))).page).toBe("3")
  })

  it("includes a trimmed search term", () => {
    expect(paramsOf(buildListUrl("/contacts", q({ search: "  ada  " }))).search).toBe("ada")
  })

  it("omits an empty or whitespace-only search", () => {
    expect(paramsOf(buildListUrl("/contacts", q({ search: "   " }))).search).toBeUndefined()
    expect(paramsOf(buildListUrl("/contacts", q({ search: "" }))).search).toBeUndefined()
  })

  it("applies the active tab's query params", () => {
    const url = buildListUrl("/contacts", q({ tab: "active" }), TABS)
    expect(paramsOf(url).status).toBe("active")
  })

  it("applies nothing extra for a tab with an empty query", () => {
    expect(paramsOf(buildListUrl("/contacts", q({ tab: "all" }), TABS))).toEqual({
      page: "1",
      limit: "20",
    })
  })

  it("lets an explicit filter override the tab on the same key", () => {
    const url = buildListUrl(
      "/contacts",
      q({ tab: "active", filters: { status: "archived" } }),
      TABS,
    )
    expect(paramsOf(url).status).toBe("archived")
  })

  it("drops a filter whose value is empty", () => {
    const url = buildListUrl("/contacts", q({ filters: { status: "", typeId: "t1" } }))
    const p = paramsOf(url)
    expect(p.status).toBeUndefined()
    expect(p.typeId).toBe("t1")
  })

  it("sends sort and order together", () => {
    const url = buildListUrl("/contacts", q({ sort: { key: "createdAt", dir: "desc" } }))
    expect(paramsOf(url)).toMatchObject({ sort: "createdAt", order: "desc" })
  })

  it("url-encodes a search term with spaces and symbols", () => {
    const url = buildListUrl("/contacts", q({ search: "a&b c" }))
    expect(url).toContain("search=a%26b+c")
    expect(paramsOf(url).search).toBe("a&b c")
  })
})

describe("pageCount", () => {
  it("is 1 for an empty result, so the pager still reads sensibly", () => {
    expect(pageCount(0, 20)).toBe(1)
  })

  it("rounds a partial page up", () => {
    expect(pageCount(21, 20)).toBe(2)
    expect(pageCount(40, 20)).toBe(2)
    expect(pageCount(41, 20)).toBe(3)
  })

  it("survives a zero limit without dividing by zero", () => {
    expect(pageCount(100, 0)).toBe(1)
  })
})

describe("clampPage", () => {
  it("leaves an in-range page alone", () => {
    expect(clampPage(2, 100, 20)).toBe(2)
  })

  it("pulls back a page past the end — e.g. after deleting the last row", () => {
    expect(clampPage(5, 21, 20)).toBe(2)
  })

  it("never goes below 1", () => {
    expect(clampPage(0, 100, 20)).toBe(1)
    expect(clampPage(-3, 100, 20)).toBe(1)
  })

  it("lands on 1 when everything was deleted", () => {
    expect(clampPage(4, 0, 20)).toBe(1)
  })
})

describe("initialQuery", () => {
  it("starts on page 1 at the default limit", () => {
    expect(initialQuery()).toMatchObject({ page: 1, limit: DEFAULT_LIMIT, filters: {} })
  })

  it("selects the first tab when tabs are configured", () => {
    expect(initialQuery(TABS).tab).toBe("all")
  })

  it("leaves the tab unset when there are none", () => {
    expect(initialQuery().tab).toBeUndefined()
  })
})
