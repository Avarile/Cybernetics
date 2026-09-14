import type { TableQuery } from "./query"
import type { DomainTableConfig, HasId, TabSpec } from "./types"

/** The string a filter or search compares against. Missing ⇒ never matches. */
function fieldText(row: unknown, key: string): string | null {
  const v = (row as Record<string, unknown>)[key]
  if (v == null) return null
  if (typeof v === "object") return null
  return String(v)
}

const missing = (v: unknown) => v == null || v === ""

/** Numeric when both sides parse; otherwise locale string order. */
function compare(a: unknown, b: unknown): number {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return String(a).localeCompare(String(b))
}

/**
 * One column's comparator, with blanks pinned last in BOTH directions.
 *
 * Applying the direction sign to a blank's rank would open a descending sort
 * with a wall of empty cells — the rows carrying least information pushed in
 * front of the ones the user asked to see first.
 */
function compareWithDirection(a: unknown, b: unknown, sign: 1 | -1): number {
  if (missing(a) && missing(b)) return 0
  if (missing(a)) return 1
  if (missing(b)) return -1
  return sign * compare(a, b)
}

/**
 * Apply a TableQuery to an in-memory array.
 *
 * Order matches what the server does for paged endpoints — tab params, then
 * filters, then search, then sort, then the page slice — so a `collection`
 * table and a `paged` table behave identically from the outside. A difference
 * here would show up as "search works on Accounts but not on Transactions",
 * which reads as a broken filter rather than two code paths.
 *
 * Pure and separately tested for the same reason `buildListUrl` is: the ways
 * this goes wrong are silent. A dropped filter still returns rows, just the
 * wrong ones.
 */
export function applyCollectionQuery<T extends HasId>(
  rows: T[],
  query: TableQuery,
  config: Pick<DomainTableConfig<T>, "columns" | "tabs">,
): { rows: T[]; total: number } {
  let out = rows

  // Tab params first, so an explicit filter on the same key wins — the same
  // precedence buildListUrl applies for paged endpoints.
  const tab: TabSpec | undefined = config.tabs?.find((t) => t.value === query.tab)
  const params: Record<string, string> = { ...(tab?.query ?? {}) }
  for (const [k, v] of Object.entries(query.filters)) {
    if (v) params[k] = v
  }

  for (const [k, v] of Object.entries(params)) {
    out = out.filter((r) => fieldText(r, k) === v)
  }

  const term = query.search?.trim().toLowerCase()
  if (term) {
    // Over the fields the columns name, not over rendered cells — a cell
    // returns a ReactNode, which has no searchable text without rendering it.
    const keys = config.columns.map((c) => c.key)
    out = out.filter((r) =>
      keys.some((k) => fieldText(r, k)?.toLowerCase().includes(term) ?? false),
    )
  }

  if (query.sort) {
    const { key, dir } = query.sort
    const sign = dir === "desc" ? -1 : 1
    out = [...out].sort((a, b) =>
      compareWithDirection(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        sign,
      ),
    )
  }

  // `total` is the filtered count, before the slice — it is what the pager
  // divides by, and counting the slice would report "20 rows" forever.
  const total = out.length
  const start = (query.page - 1) * query.limit
  return { rows: out.slice(start, start + query.limit), total }
}
