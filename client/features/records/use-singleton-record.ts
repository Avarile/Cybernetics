"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { useApi } from "@/lib/swr/provider"
import { keys, scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"

/**
 * A resource of one — `GET /me/profile`, `PATCH /me/profile`.
 *
 * `useRecordMutations.update` composes `${endpoint}/${id}`, which is wrong
 * when there is no id: the profile endpoint IS the record. Cached under the
 * `collection` head for the same reason — a singleton has no id to key on.
 */
export function useSingletonRecord<T>(endpoint: string) {
  const { client } = useApi()
  const invalidate = useInvalidate()
  const [saving, setSaving] = useState(false)

  const { data, error, isLoading } = useSWR<T>(endpoint ? keys.collection(endpoint) : null)

  const save = useCallback(
    async (body: unknown) => {
      setSaving(true)
      try {
        await client.patch(endpoint, body)
        await invalidate(scopes.allCollections(endpoint))
      } finally {
        setSaving(false)
      }
    },
    [client, endpoint, invalidate],
  )

  return { record: data ?? null, isLoading, error, save, saving }
}
