"use client"

import { useCallback, useState } from "react"
import { ApiError } from "@/lib/api/errors"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/api/types"
import { useApi } from "@/lib/swr/provider"

export interface ChangePasswordResult {
  ok: boolean
  message?: string
}

/**
 * `PATCH /auth/password`.
 *
 * The length rules are the backend's own (`change-password.dto.ts`, mirrored
 * in `lib/api/types.ts`), checked here so a too-short password fails before
 * the request rather than as a 422 naming a field the form calls something
 * else. The match check has no server equivalent at all — the API takes one
 * new password, and the confirmation exists only to catch a typo.
 */
export function useChangePassword() {
  const { client } = useApi()
  const [busy, setBusy] = useState(false)

  const change = useCallback(
    async (currentPassword: string, newPassword: string, confirmation: string): Promise<ChangePasswordResult> => {
      if (newPassword.length < PASSWORD_MIN_LENGTH || newPassword.length > PASSWORD_MAX_LENGTH) {
        return {
          ok: false,
          message: `A password must be ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`,
        }
      }
      if (newPassword !== confirmation) {
        return { ok: false, message: "The two new passwords do not match" }
      }

      setBusy(true)
      try {
        await client.patch("/auth/password", { currentPassword, newPassword })
        return { ok: true }
      } catch (err) {
        return {
          ok: false,
          message: err instanceof ApiError ? err.message : "Could not change the password",
        }
      } finally {
        setBusy(false)
      }
    },
    [client],
  )

  return { change, busy }
}
