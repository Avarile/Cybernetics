"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/errors"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useRecordMutations } from "@/features/records/use-record-mutations"

export interface ConfirmWindowProps {
  message: string
  confirmLabel?: string
  destructive?: boolean
  /** Rows to DELETE from `endpoint`. */
  ids?: string[]
  endpoint?: string
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
  __windowId,
}: ConfirmWindowProps) {
  // `__windowId` is only absent when this component is rendered outside a
  // WindowLayer; `useWindowControls` still needs some id to call the hook
  // with, and closing a window that doesn't exist is a no-op.
  const { close: closeWindow } = useWindowControls(__windowId ?? "")
  // `endpoint` may be undefined (a non-delete confirm dialog); `remove` is
  // only ever called when both `ids` and `endpoint` are present, but the hook
  // itself needs some endpoint to call `useApi`/`useInvalidate` against.
  const { remove } = useRecordMutations(endpoint ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (__windowId) closeWindow()
  }

  async function confirm() {
    if (!ids?.length || !endpoint) {
      close()
      return
    }
    setPending(true)
    setError(null)

    const outcome = await remove(ids)

    setPending(false)

    if (outcome.failed === 0) {
      close()
      return
    }

    setError(
      `${outcome.deleted} of ${ids.length} deleted. ` +
        (outcome.firstError instanceof ApiError ? outcome.firstError.message : "Some deletions failed."),
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
