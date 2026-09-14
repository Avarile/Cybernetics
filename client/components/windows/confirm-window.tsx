"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ApiError } from "@/lib/api/errors"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useRecordMutations } from "@/features/records/use-record-mutations"
import { useRowAction } from "@/features/records/use-row-action"

export interface ConfirmWindowProps {
  message: string
  confirmLabel?: string
  destructive?: boolean
  /**
   * Path segments to DELETE from `endpoint`, one request each.
   *
   * Row ids for most domains, but not all: suppressions delete by email,
   * project members by userId, preferences by key. `DomainTableConfig.
   * deleteKey` decides, and this window just uses what it is handed.
   */
  ids?: string[]
  endpoint?: string
  /**
   * A verb to POST instead of a delete — "Void this invoice", "Reverse this
   * transaction", "Materialize the due schedules".
   *
   * Separate from `ids` because the confirmation is the same UI but the
   * consequence is not: a delete removes rows, a verb writes new ones.
   */
  postTo?: string
  body?: unknown
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
  postTo,
  body,
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
  // A verb targets whatever path it was given; the endpoint here is only the
  // invalidation scope, which a verb shares with the domain it acts on.
  const { run } = useRowAction(endpoint ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    if (__windowId) closeWindow()
  }

  async function confirm() {
    // A verb, not a delete: one request, and the outcome is all-or-nothing.
    if (postTo) {
      setPending(true)
      setError(null)
      const result = await run(postTo, body)
      setPending(false)
      if (result.ok) close()
      else setError(result.message ?? "That did not work")
      return
    }

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
