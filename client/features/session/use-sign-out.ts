"use client"

import { useSWRConfig } from "swr"
import { resetClientState } from "@/lib/state/reset"
import { useApi } from "@/lib/swr/provider"
import { useSessionStore } from "@/stores/session.store"

/**
 * Ends the session: revokes the refresh token server-side, then clears every
 * client store and the SWR cache through the single reset choke point.
 */
export function useSignOut() {
  const { auth } = useApi()
  const { mutate } = useSWRConfig()

  return async function signOut() {
    const refresh = useSessionStore.getState().refreshToken
    if (refresh) await auth.logout(refresh).catch(() => undefined)
    // No explicit reopen: useAuthGate brings the gate back as soon as the
    // cleared store says we are signed out.
    resetClientState(mutate)
  }
}
