"use client"

import { useCallback, useState } from "react"
import { useSWRConfig } from "swr"
import { toast } from "sonner"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/swr/provider"
import { keys } from "@/lib/swr/keys"

export interface CellWrite<T> {
  /** Row identity, so the table can mark just this row as saving or failed. */
  rowKey: string
  method: "put" | "patch" | "post"
  path: string
  body: unknown
  /** Applied to the cached array before the request, reverted if it fails. */
  optimistic: (rows: T[]) => T[]
}

/**
 * In-cell edits, with optimistic update and rollback.
 *
 * Notification preferences and user preferences are settings, not records:
 * a Switch and a Select in the row, not a form in a window. That only works
 * if the control moves immediately, so the write is applied to the cache
 * first and reverted on failure.
 *
 * A failed row stays visibly marked rather than silently snapping back —
 * a switch that flips itself off again with no explanation reads as "the
 * setting didn't stick" and invites the user to try forever.
 */
export function useCellMutation<T>(endpoint: string) {
  const { client } = useApi()
  const { mutate } = useSWRConfig()
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map())

  const write = useCallback(
    async ({ rowKey, method, path, body, optimistic }: CellWrite<T>) => {
      const key = keys.collection(endpoint)
      setSaving((s) => new Set(s).add(rowKey))
      setFailed((f) => {
        if (!f.has(rowKey)) return f
        const next = new Map(f)
        next.delete(rowKey)
        return next
      })

      // Snapshot before the optimistic write, so the rollback restores what
      // was actually there rather than re-deriving it.
      let snapshot: T[] | undefined
      await mutate(
        key,
        (current: T[] | undefined) => {
          snapshot = current
          return current ? optimistic(current) : current
        },
        { revalidate: false },
      )

      try {
        await client[method](path, body)
        await mutate(key)
      } catch (err) {
        await mutate(key, snapshot, { revalidate: false })
        const message = err instanceof ApiError ? err.message : "Could not save that"
        setFailed((f) => new Map(f).set(rowKey, message))
        toast.error(message)
      } finally {
        setSaving((s) => {
          const next = new Set(s)
          next.delete(rowKey)
          return next
        })
      }
    },
    [client, endpoint, mutate],
  )

  return { write, saving, failed }
}
