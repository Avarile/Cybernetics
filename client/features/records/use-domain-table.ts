"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { rowsOf, type Paginated } from "@/lib/api/types"
import { keys, scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { clampPage, initialQuery, type TableQuery } from "@/components/data-table/query"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"

export type TableStatus = "loading" | "ready" | "error"

export interface DomainTable<T> {
  rows: T[]
  total: number
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
export function useDomainTable<T extends HasId>(config: DomainTableConfig<T>): DomainTable<T> {
  const [query, setQueryState] = useState<TableQuery>(() => initialQuery(config.tabs))
  const invalidate = useInvalidate()

  const { data, error, isLoading } = useSWR<Paginated<T>>(
    keys.list(config.endpoint, query, config.tabs),
    // The one place in the app that wants laggy data. Paging changes the key,
    // so without this the table empties to a skeleton and re-fills on every
    // page — a flicker under the user's cursor. It is safe HERE and nowhere
    // else because the key identifies a page of one list, not which entity is
    // on screen: the worst a stale render shows is the previous page of the
    // same domain, never another record, another conversation or another user.
    { keepPreviousData: true },
  )

  const total = data?.total ?? 0

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
    rows: rowsOf(data),
    total,
    status: error ? "error" : isLoading ? "loading" : "ready",
    error: error instanceof Error ? error.message : error ? "Could not load this list" : null,
    query,
    setQuery,
    setFilter,
    refresh,
  }
}
