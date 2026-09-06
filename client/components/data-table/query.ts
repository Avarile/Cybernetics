import type { TabSpec } from "./types"

/** The query state the table owns. Page is 1-based, matching the API. */
export interface TableQuery {
  page: number
  limit: number
  search?: string
  tab?: string
  filters: Record<string, string>
  sort?: { key: string; dir: "asc" | "desc" }
}

export const DEFAULT_LIMIT = 20
export const PAGE_SIZES = [10, 20, 30, 40, 50] as const

export function initialQuery(tabs?: TabSpec[]): TableQuery {
  return { page: 1, limit: DEFAULT_LIMIT, tab: tabs?.[0]?.value, filters: {} }
}

/**
 * Builds the request URL for a page of a domain.
 *
 * Pure and separately tested, because the ways this goes wrong are silent: a
 * dropped filter still returns rows, just the wrong ones, and an off-by-one on
 * `page` shows plausible data from the neighbouring page.
 */
export function buildListUrl(
  endpoint: string,
  query: TableQuery,
  tabs?: TabSpec[],
): string {
  const params = new URLSearchParams()
  params.set("page", String(query.page))
  params.set("limit", String(query.limit))

  if (query.search?.trim()) params.set("search", query.search.trim())

  // Tab params first, so an explicit filter on the same key wins.
  const tab = tabs?.find((t) => t.value === query.tab)
  if (tab) {
    for (const [k, v] of Object.entries(tab.query)) params.set(k, v)
  }

  for (const [k, v] of Object.entries(query.filters)) {
    if (v) params.set(k, v)
    else params.delete(k)
  }

  if (query.sort) {
    params.set("sort", query.sort.key)
    params.set("order", query.sort.dir)
  }

  return `${endpoint}?${params.toString()}`
}

/** Total pages for a row count, never below 1 so the pager always reads "1 of 1". */
export function pageCount(total: number, limit: number): number {
  if (limit <= 0) return 1
  return Math.max(1, Math.ceil(total / limit))
}

/** Clamps a page into range — e.g. after a delete empties the last page. */
export function clampPage(page: number, total: number, limit: number): number {
  return Math.min(Math.max(1, page), pageCount(total, limit))
}
