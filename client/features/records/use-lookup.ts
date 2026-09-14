"use client"

import { useMemo } from "react"
import useSWR from "swr"
import { rowsOf, type Paginated } from "@/lib/api/types"
import { keys } from "@/lib/swr/keys"

export interface LookupOption {
  value: string
  label: string
}

export interface Lookup {
  /** Label for an id: "—" for null, a short id for one we could not resolve. */
  label: (id: string | null | undefined) => string
  /** True when the id resolved to a real label, so a cell can style the rest. */
  has: (id: string | null | undefined) => boolean
  options: LookupOption[]
  isLoading: boolean
  /**
   * The source has more rows than one page carries, so `label` may be
   * degrading to short ids.
   *
   * Callers surface this rather than hide it. A wrong label is worse than a
   * short one, and a silently incomplete filter dropdown is worse than both.
   */
  truncated: boolean
}

const DASH = "—"

/**
 * Foreign keys as labels, and as filter options.
 *
 * Half the columns in Finance and Projects hold ids the API does not expand:
 * `transactions.accountId`, `tasks.projectId`, `invoices.contactId`,
 * `budgets.projectId`. A raw uuid in a table cell is not information.
 *
 * One SWR key per endpoint, shared by every consumer — the Account column,
 * the Account filter and the Account field on the create form are one
 * request, not three.
 *
 * The fetcher asks for `?limit=100`, the cap every list DTO declares. Past
 * that we cannot label every row, and `truncated` says so. A batch `?ids=`
 * endpoint is the real fix; it does not exist yet.
 */
export function useLookup(endpoint: string, labelKey = "name", valueKey = "id"): Lookup {
  const { data, isLoading } = useSWR<Paginated<Record<string, unknown>> | Record<string, unknown>[]>(
    endpoint ? keys.lookup(endpoint) : null,
  )

  return useMemo(() => {
    // Both envelope shapes: a lookup source may be paged (/projects) or a
    // bare array (/finance/accounts).
    const rows = Array.isArray(data) ? data : rowsOf(data)
    const total = Array.isArray(data) ? rows.length : (data?.total ?? rows.length)

    const byId = new Map<string, string>()
    const options: LookupOption[] = []
    for (const row of rows) {
      const value = row[valueKey]
      if (typeof value !== "string") continue
      const raw = row[labelKey]
      const label = raw == null || raw === "" ? value.slice(0, 8) : String(raw)
      byId.set(value, label)
      options.push({ value, label })
    }

    return {
      label: (id) => (id == null || id === "" ? DASH : (byId.get(id) ?? id.slice(0, 8))),
      has: (id) => (id == null || id === "" ? false : byId.has(id)),
      options,
      isLoading,
      truncated: total > rows.length,
    }
  }, [data, isLoading, labelKey, valueKey])
}
