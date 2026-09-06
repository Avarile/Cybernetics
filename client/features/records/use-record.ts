"use client"

import useSWR from "swr"
import { keys } from "@/lib/swr/keys"

export function useRecord(endpoint: string, id?: string) {
  // No `keepPreviousData` — SWR's default, and it must stay that way for any
  // hook whose key identifies WHICH entity is being shown: SWR's laggyDataRef
  // has no guard for a null key, so it would return the PREVIOUS record, or
  // the last one viewed once the id goes undefined.
  const { data, error, isLoading } = useSWR<Record<string, unknown>>(
    id ? keys.record(endpoint, id) : null,
  )
  return { record: data ?? null, isLoading: Boolean(id) && isLoading, error }
}
