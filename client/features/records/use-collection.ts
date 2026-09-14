"use client"

import { useCallback, useMemo, useState } from "react"
import useSWR from "swr"
import { keys, scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { applyCollectionQuery } from "@/components/data-table/collection-query"
import { clampPage, initialQuery, type TableQuery } from "@/components/data-table/query"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"
import type { DomainTable } from "./use-domain-table"

/**
 * A bare-array endpoint, presented as a DomainTable.
 *
 * Fourteen-odd endpoints return a naked `T[]` with no envelope and no paging:
 * `/finance/accounts`, `/finance/recurring`, `/me/preferences`,
 * `/notifications/preferences`, `/projects/:id/members`, every vocabulary
 * list. Paging, filtering and search happen here, over data already in hand.
 *
 * Client-side is correct HERE and nowhere else. These are bounded sets — tens
 * of rows, fetched whole in one request. The 282 contacts that forced server
 * paging in the first place never come through this path, and a domain that
 * outgrows it should move to a paged endpoint rather than be given a bigger
 * `limit`.
 *
 * Returns the same shape as `usePagedTable`, so `DataTable` never learns which
 * kind of endpoint it is rendering.
 */
export function useCollection<T extends HasId>(
  config: DomainTableConfig<T>,
  enabled: boolean,
  /** Rows from a parent record, for `source: "inline"`. */
  inline?: T[],
): DomainTable<T> {
  const [query, setQueryState] = useState<TableQuery>(() => initialQuery(config.tabs, config.defaultSort))
  const invalidate = useInvalidate()

  // No `keepPreviousData`: paging is a useMemo over data already held, so
  // there is no fetch for it to paper over.
  const isInline = config.source === "inline"
  const { data: fetched, error, isLoading } = useSWR<T[]>(
    enabled && !isInline ? keys.collection(config.endpoint) : null,
  )
  const data = isInline ? inline : fetched

  // A non-array response means the endpoint changed shape under us. Reporting
  // it as an error beats rendering an empty table, which is indistinguishable
  // from a legitimately empty domain — the exact failure `/files` produced
  // when it started answering with `items`.
  const shapeError = !isInline && data !== undefined && !Array.isArray(data)

  // Keyed on the two fields `applyCollectionQuery` actually reads, not on the
  // whole config. `config` reaches here as `{ ...config, ...extras }` from
  // SectionHost — a different object every render before that merge was
  // memoised — and depending on it meant this filtered, searched, sorted and
  // sliced the entire collection on every render of the window, including the
  // one every click triggers through focusWindow.
  const columns = config.columns
  const tabs = config.tabs
  const { rows, total } = useMemo(
    () =>
      Array.isArray(data)
        ? applyCollectionQuery(data, query, { columns, tabs })
        : { rows: [] as T[], total: 0 },
    [data, query, columns, tabs],
  )

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
    setQueryState((q) => ({ ...q, page: clampPage(q.page, total, q.limit) }))
    void invalidate(scopes.allCollections(config.endpoint))
  }, [config.endpoint, invalidate, total])

  return {
    rows,
    total,
    status: error || shapeError ? "error" : isInline ? "ready" : isLoading ? "loading" : "ready",
    error: shapeError
      ? "Unexpected response shape for this list"
      : error instanceof Error
        ? error.message
        : error
          ? "Could not load this list"
          : null,
    query,
    setQuery,
    setFilter,
    refresh,
  }
}
