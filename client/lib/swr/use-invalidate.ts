"use client"

import { useCallback } from "react"
import { useSWRConfig } from "swr"
import { hasPrefix } from "./match"

/**
 * Revalidates every cache entry under a key prefix.
 *
 * This replaces the `refreshToken: number` prop the tables used to thread down
 * and the `onDone` callbacks that travelled inside window props. A prefix
 * reaches every subscriber of that data, so deleting a row in one window
 * refreshes a second window showing the same list — which a callback held by
 * one opener never could.
 */
export function useInvalidate() {
  const { mutate } = useSWRConfig()
  // The explicit return type matters: ScopedMutator's filter overload infers
  // `Promise<any[]>`, and `any` would silently defeat type-checking in every
  // consumer that starts using the resolved value.
  return useCallback(
    (prefix: readonly unknown[]): Promise<unknown[]> => mutate((key) => hasPrefix(key, prefix)),
    [mutate],
  )
}
