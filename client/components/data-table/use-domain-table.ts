"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/api/provider"
import { rowsOf, type Paginated } from "@/lib/api/types"
import { buildListUrl, clampPage, initialQuery, type TableQuery } from "./query"
import type { DomainTableConfig, HasId } from "./types"

export type TableStatus = "idle" | "loading" | "ready" | "error"

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
 * The demo `data-table.tsx` this generalises paginates client-side. Every list
 * endpoint here is server-paginated and returns `{ data, total, page, limit }`,
 * so keeping the client model would have paged only the 20 rows already
 * fetched and misreported every total.
 */
export function useDomainTable<T extends HasId>(
  config: DomainTableConfig<T>,
  /** Bump to force a refetch from outside — e.g. after an upload completes. */
  refreshToken = 0,
): DomainTable<T> {
  const { client } = useApi()
  const [query, setQueryState] = useState<TableQuery>(() => initialQuery(config.tabs))
  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<TableStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // Guards against an out-of-order response overwriting a newer one: typing in
  // the search box fires several requests and they can land in any order.
  const requestSeq = useRef(0)

  useEffect(() => {
    const seq = ++requestSeq.current
    let cancelled = false

    async function load() {
      setStatus("loading")
      setError(null)
      try {
        const page = await client.get<Paginated<T>>(
          buildListUrl(config.endpoint, query, config.tabs),
        )
        if (cancelled || seq !== requestSeq.current) return
        setRows(rowsOf(page))
        setTotal(page.total ?? 0)
        setStatus("ready")
      } catch (err) {
        if (cancelled || seq !== requestSeq.current) return
        setError(err instanceof ApiError ? err.message : "Could not load this list")
        setStatus("error")
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [client, config.endpoint, config.tabs, query, nonce, refreshToken])

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
    setNonce((n) => n + 1)
  }, [total])

  return { rows, total, status, error, query, setQuery, setFilter, refresh }
}
