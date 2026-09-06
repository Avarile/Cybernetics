"use client"

import useSWR from "swr"
import { keys } from "@/lib/swr/keys"
import type { UserProfile } from "@/lib/api/types"
import { useSessionStore } from "@/stores/session.store"

export interface Session {
  principal: UserProfile | null
  /** A token *and* a principal. Either alone is a half-session. */
  authed: boolean
  /** The session is still resolving — never show the gate while this is true. */
  settling: boolean
  error: unknown
}

/**
 * The session, composed from the token store and the server's principal.
 *
 * `settling` is what the auth gate keys on, and it covers all three ways a
 * session can be mid-resolution: a persisted refresh token not yet exchanged, an
 * exchange in flight, and a principal being fetched. Deriving it from SWR state
 * — which is correct *within* the render — is what removed the previous
 * implementation's `getState()` escape hatch, where a render-time capture of a
 * hand-rolled status was stale in the same commit and flashed the login dialog
 * at a returning user.
 */
export function useSession(): Session {
  const accessToken = useSessionStore((s) => s.accessToken)
  const refreshToken = useSessionStore((s) => s.refreshToken)
  const refreshing = useSessionStore((s) => s.refreshing)

  // No `keepPreviousData` — SWR's default, and it must stay that way. Its
  // laggy-data ref lives on this hook instance rather than the cache entry, so
  // it survives `resetClientState`'s cache eviction and would report the
  // PREVIOUS user's principal (with `authed: true`) for however long the next
  // user's own fetch takes to resolve.
  const { data, isLoading, error } = useSWR<UserProfile>(accessToken ? keys.session() : null)

  return {
    principal: data ?? null,
    authed: Boolean(accessToken && data),
    settling:
      refreshing ||
      (Boolean(refreshToken) && !accessToken) ||
      // Not `isLoading`: SWR reports false on the render where the key first
      // activates (isInitialMount is already false by then), so this must
      // mean "we hold a token but have no verdict yet".
      (Boolean(accessToken) && (isLoading || (!data && !error))),
    error,
  }
}
