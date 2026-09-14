"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { rowsOf, type Paginated } from "@/lib/api/types"
import { keys, scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { clampPage, initialQuery, type TableQuery } from "@/components/data-table/query"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"
import { useCollection } from "./use-collection"

export type TableStatus = "loading" | "ready" | "error"

export interface DomainTable<T> {
  rows: T[]
  /** What the pager divides by: the size of the whole collection. */
  total: number
  /**
   * Rows the server removed from THIS page after fetching it.
   *
   * Knowledge only, and only ever non-zero for a principal who cannot see
   * everything. Undefined for every endpoint that filters in SQL.
   */
  hiddenOnPage?: number
  status: TableStatus
  error: string | null
  query: TableQuery
  setQuery: (patch: Partial<TableQuery>) => void
  setFilter: (key: string, value: string) => void
  refresh: () => void
}

/**
 * Server-paginated data for one domain.
 *
 * The query is local state — it belongs to this window, and two open Contacts
 * windows should be able to sit on different pages. Only the fetch is shared,
 * through a cache key derived from that query.
 *
 * The previous implementation carried a `requestSeq` ref to discard
 * out-of-order responses while typing in the search box. That guard is gone
 * because it is no longer needed: SWR keys a response to the query that asked
 * for it, so a slow response cannot land in a newer query's slot.
 */
export function usePagedTable<T extends HasId>(
  config: DomainTableConfig<T>,
  enabled: boolean,
): DomainTable<T> {
  const [query, setQueryState] = useState<TableQuery>(() =>
    initialQuery(config.tabs, config.defaultSort),
  )
  const invalidate = useInvalidate()

  const { data, error, isLoading } = useSWR<Paginated<T>>(
    enabled ? keys.list(config.endpoint, query, config.tabs) : null,
    // The one place in the app that wants laggy data. Paging changes the key,
    // so without this the table empties to a skeleton and re-fills on every
    // page — a flicker under the user's cursor. It is safe HERE and nowhere
    // else because the key identifies a page of one list, not which entity is
    // on screen: the worst a stale render shows is the previous page of the
    // same domain, never another record, another conversation or another user.
    { keepPreviousData: true },
  )

  /**
   * The pager's total, which is NOT always `data.total`.
   *
   * `knowledge.service.list` pages in SQL, then drops rows the principal
   * cannot see, and returns `total: visible.length` — the count ON THIS
   * PAGE, capped by `limit`. Verified live: `?limit=20` answers
   * `total: 20, totalBeforeAccess: 186` on every page. Dividing by that
   * gives "Page 1 of 1" for 186 records and strands the other 166.
   *
   * `totalBeforeAccess` is the collection size, so it is what the pager
   * needs wherever the server sends it.
   */
  const total = data?.totalBeforeAccess ?? data?.total ?? 0

  /**
   * How many rows this page lost to access filtering.
   *
   * Derivable exactly: the server asked SQL for `limit` rows, so anything
   * short of that on a non-final page was filtered out. On the final page a
   * short result is simply the end of the collection, not a hidden row.
   */
  const rows = rowsOf(data)
  const isFinalPage = query.page * query.limit >= total
  const hiddenOnPage =
    data?.totalBeforeAccess == null || isFinalPage
      ? undefined
      : Math.max(0, query.limit - rows.length)

  const setQuery = useCallback((patch: Partial<TableQuery>) => {
    setQueryState((q) => {
      const next = { ...q, ...patch }
      // Any change other than the page itself returns to page 1 — otherwise a
      // narrowed filter leaves the user on a page that no longer exists.
      if (patch.page === undefined) next.page = 1
      return next
    })
  }, [])

  const setFilter = useCallback(
    (key: string, value: string) =>
      setQueryState((q) => ({ ...q, page: 1, filters: { ...q.filters, [key]: value } })),
    [],
  )

  const refresh = useCallback(() => {
    // Re-clamp first: a delete can empty the last page.
    setQueryState((q) => ({ ...q, page: clampPage(q.page, total, q.limit) }))
    void invalidate(scopes.allLists(config.endpoint))
  }, [config.endpoint, invalidate, total])

  return {
    rows,
    total,
    hiddenOnPage,
    status: error ? "error" : isLoading ? "loading" : "ready",
    error: error instanceof Error ? error.message : error ? "Could not load this list" : null,
    query,
    setQuery,
    setFilter,
    refresh,
  }
}

/**
 * A page of one domain, from whichever kind of endpoint it has.
 *
 * Both hooks always run — hooks cannot be called conditionally — and the
 * inactive one is keyed `null`, so it holds no cache entry and issues no
 * request. The alternative, branching at the call site, would push the
 * distinction into every domain window and put it in `DataTable`'s way.
 */
export function useDomainTable<T extends HasId>(
  config: DomainTableConfig<T>,
  /** Rows already in hand, for `source: "inline"`. */
  inline?: T[],
): DomainTable<T> {
  const clientSide = config.source === "collection" || config.source === "inline"
  const paged = usePagedTable(config, !clientSide)
  const collection = useCollection(config, clientSide, inline)
  return clientSide ? collection : paged
}
