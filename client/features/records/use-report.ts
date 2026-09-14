"use client"

import useSWR from "swr"
import { keys } from "@/lib/swr/keys"

export interface Report<T> {
  data: T | undefined
  isLoading: boolean
  error: unknown
}

/**
 * One aggregate endpoint over a date range.
 *
 * A thin hook rather than a `useSWR` call in the pane, because UI components
 * consume `features/**` and not SWR directly — the rule that keeps cache
 * keys, envelopes and the fetcher in one layer instead of spread across
 * every component that happens to need data.
 *
 * The path carries the range, so the path is the cache key: two ranges are
 * two entries, and changing the range revalidates rather than mutates.
 */
export function useReport<T>(path: string | null): Report<T> {
  const { data, error, isLoading } = useSWR<T>(path ? keys.report(path) : null)
  return { data, isLoading, error }
}
