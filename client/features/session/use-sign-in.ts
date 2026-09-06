"use client"

import { useCallback, useState } from "react"
import { useSWRConfig } from "swr"
import { ApiError } from "@/lib/api/errors"
import { keys } from "@/lib/swr/keys"
import { useApi } from "@/lib/swr/provider"
import type { TokenPair } from "@/lib/api/types"
import { useSessionStore } from "@/stores/session.store"

/**
 * The two ways in. Both end by seeding the principal cache from the login
 * response's own follow-up call, so `authed` flips in the same tick rather than
 * after a second render.
 */
export function useSignIn() {
  const { client, auth } = useApi()
  const { mutate } = useSWRConfig()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(
    async (getPair: () => Promise<TokenPair>, failure: string) => {
      setPending(true)
      setError(null)
      try {
        useSessionStore.getState().setTokens(await getPair())
        // Populate the session key directly: without it the gate would wait a
        // full revalidation round-trip before closing.
        await mutate(keys.session(), await auth.me(), { revalidate: false })
      } catch (err) {
        // Clear rather than leave half a session behind: login may have
        // succeeded and /auth/me failed, which would otherwise leave tokens
        // with no principal.
        useSessionStore.getState().clear()
        await mutate(keys.session(), undefined, { revalidate: false })
        setError(err instanceof ApiError ? err.message : failure)
      } finally {
        setPending(false)
      }
    },
    [auth, mutate],
  )

  const signIn = useCallback(
    (email: string, password: string) =>
      run(() => auth.login({ email, password }), "Could not sign in"),
    [auth, run],
  )

  const register = useCallback(
    (input: { email: string; password: string; displayName?: string }) =>
      run(
        () =>
          client.post<TokenPair>("/auth/register", {
            email: input.email,
            password: input.password,
            displayName: input.displayName || undefined,
          }),
        "Could not create the account",
      ),
    [client, run],
  )

  return { signIn, register, pending, error }
}
