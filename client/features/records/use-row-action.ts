"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/swr/provider"
import { scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"

export interface RowActionResult {
  ok: boolean
  message?: string
}

/**
 * A verb endpoint, as a row action.
 *
 * Finance and Knowledge expose state changes as POSTs rather than fields:
 *
 *   POST /finance/transactions/:id/status/:status
 *   POST /finance/transactions/:id/reverse
 *   POST /invoices/:id/issue | /void | /payments | /lines | /bill-time
 *   POST /knowledge/:id/status            { status, note }
 *
 * A form that PATCHed `status` would be lying about what the server accepts:
 * `knowledge.service` enforces a transition table, and `ledger.service` guards
 * status moves with a row lock precisely because the read-decide-write
 * sequence must be serial. The set of legal next states is a property of the
 * current row, not a dropdown of every enum value.
 */
export function useRowAction(endpoint: string) {
  const { client } = useApi()
  const invalidate = useInvalidate()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (path: string, body?: unknown, successMessage?: string): Promise<RowActionResult> => {
      setPending(path)
      setError(null)
      try {
        await client.post(path, body)
        // Lists, records AND collections: a posted transaction changes the
        // ledger page, the row's own detail, and the account balance that a
        // collection endpoint serves.
        await Promise.all([
          invalidate(scopes.allLists(endpoint)),
          invalidate(scopes.allRecords(endpoint)),
          invalidate(scopes.allCollections(endpoint)),
        ])
        if (successMessage) toast.success(successMessage)
        return { ok: true }
      } catch (err) {
        // Returned as well as stored: a toast that vanishes is not an error
        // report, and the caller usually wants to keep the row marked.
        const message = err instanceof ApiError ? err.message : "That did not work"
        setError(message)
        toast.error(message)
        return { ok: false, message }
      } finally {
        setPending(null)
      }
    },
    [client, endpoint, invalidate],
  )

  return { run, pending, error, clearError: () => setError(null) }
}
