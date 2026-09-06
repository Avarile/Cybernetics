"use client"

import { useCallback, useState } from "react"
import { useApi } from "@/lib/swr/provider"

/**
 * Requests a password-reset code.
 *
 * There is no failure branch, deliberately. The endpoint answers identically
 * for a known and an unknown address, so there is nothing to tell the user
 * apart — and reporting a rejection here would turn the form into the
 * account-existence oracle the API is shaped to avoid being. `sent` is
 * therefore set in `finally`, and the error is swallowed rather than surfaced.
 */
export function useForgotPassword() {
  const { auth } = useApi()
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)

  const request = useCallback(
    async (email: string) => {
      setPending(true)
      try {
        await auth.forgotPassword(email)
      } catch {
        // deliberately swallowed: see above
      } finally {
        setSent(true)
        setPending(false)
      }
    },
    [auth],
  )

  return { sent, pending, request }
}
