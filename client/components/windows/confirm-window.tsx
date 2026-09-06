"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/api/provider"
import { useWindowStore } from "@/stores/window.store"

export interface ConfirmWindowProps {
  message: string
  confirmLabel?: string
  destructive?: boolean
  /** Rows to DELETE from `endpoint`. */
  ids?: string[]
  endpoint?: string
  onDone?: () => void
  /** Window id, injected by WindowLayer so the dialog can close itself. */
  __windowId?: string
}

/**
 * The one destructive-confirm dialog.
 *
 * Deletes are issued one request per id — the API exposes no bulk delete — and
 * partial failure is reported rather than swallowed: with five rows selected,
 * "3 of 5 deleted" is the honest outcome, and silently succeeding would leave
 * the user believing rows are gone that are not.
 */
export function ConfirmWindow({
  message,
  confirmLabel = "Confirm",
  destructive,
  ids,
  endpoint,
  onDone,
  __windowId,
}: ConfirmWindowProps) {
  const { client } = useApi()
  const closeWindow = useWindowStore((s) => s.closeWindow)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (__windowId) closeWindow(__windowId)
  }

  async function confirm() {
    if (!ids?.length || !endpoint) {
      onDone?.()
      close()
      return
    }
    setPending(true)
    setError(null)

    const results = await Promise.allSettled(
      ids.map((id) => client.del(`${endpoint}/${id}`)),
    )
    const failed = results.filter((r) => r.status === "rejected")

    setPending(false)
    onDone?.()

    if (failed.length === 0) {
      close()
      return
    }

    const first = failed[0] as PromiseRejectedResult
    setError(
      `${ids.length - failed.length} of ${ids.length} deleted. ` +
        (first.reason instanceof ApiError ? first.reason.message : "Some deletions failed."),
    )
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-sm text-foreground">{message}</p>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={close} disabled={pending}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant={destructive ? "destructive" : "default"}
          onClick={() => void confirm()}
          disabled={pending}
        >
          {pending ? "Working…" : confirmLabel}
        </Button>
      </div>
    </div>
  )
}
