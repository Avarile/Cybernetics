"use client"

import { useCallback } from "react"
import { useApi } from "@/lib/swr/provider"
import { scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"

export interface DeleteOutcome {
  deleted: number
  failed: number
  firstError: unknown
}

/**
 * Writes for one domain, each followed by the invalidation it implies.
 *
 * Invalidating by prefix is what makes a second window showing the same domain
 * update too. The previous design threaded an `onDone` callback down through the
 * window store's props, which meant only the opener ever learned about a change
 * — and only when the opener remembered to pass one, which Contacts did for
 * deletes and not for creates or edits.
 */
export function useRecordMutations(endpoint: string) {
  const { client } = useApi()
  const invalidate = useInvalidate()

  const create = useCallback(
    async (body: unknown) => {
      await client.post(endpoint, body)
      await invalidate(scopes.allLists(endpoint))
    },
    [client, endpoint, invalidate],
  )

  const update = useCallback(
    async (id: string, body: unknown) => {
      await client.patch(`${endpoint}/${id}`, body)
      await Promise.all([
        invalidate(scopes.allLists(endpoint)),
        invalidate(scopes.allRecords(endpoint)),
      ])
    },
    [client, endpoint, invalidate],
  )

  /**
   * Deletes are issued one request per id — the API exposes no bulk delete —
   * and partial failure is reported rather than swallowed: with five rows
   * selected, "3 of 5 deleted" is the honest outcome.
   */
  const remove = useCallback(
    async (ids: string[]): Promise<DeleteOutcome> => {
      const results = await Promise.allSettled(ids.map((id) => client.del(`${endpoint}/${id}`)))
      const rejected = results.filter((r) => r.status === "rejected")

      await Promise.all([
        invalidate(scopes.allLists(endpoint)),
        invalidate(scopes.allRecords(endpoint)),
      ])

      return {
        deleted: ids.length - rejected.length,
        failed: rejected.length,
        firstError: (rejected[0] as PromiseRejectedResult | undefined)?.reason,
      }
    },
    [client, endpoint, invalidate],
  )

  return { create, update, remove }
}
