"use client"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import type { TableStatus } from "./use-domain-table"

/**
 * The loading / empty / error triad, in one place.
 *
 * Each state is distinct on purpose: "no rows" and "the request failed" look
 * identical if both render as an empty table, and that is how a broken filter
 * gets mistaken for an empty domain.
 */
export function TableState({
  status,
  error,
  empty,
  onRetry,
}: {
  status: TableStatus
  error: string | null
  empty: string
  onRetry: () => void
}) {
  if (status === "loading" || status === "idle") {
    return (
      <div className="flex flex-col gap-2 py-6">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    )
  }

  if (status === "error") {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 py-10">
        <p className="text-sm text-destructive">{error ?? "Could not load this list"}</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <p className="py-10 text-center text-sm text-muted-foreground">{empty}</p>
  )
}
