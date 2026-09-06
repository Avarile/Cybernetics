"use client"

import { useEffect } from "react"
import { useApi } from "@/lib/swr/provider"
import { useSessionStore } from "@/stores/session.store"
import type { AuthApi } from "@/lib/api/endpoints/auth"
import type { TokenPair } from "@/lib/api/types"

// Module-level single-flight latch, mirroring client.ts's own
// `inFlightRefresh`. React's StrictMode double-invokes an effect's
// setup/cleanup once at mount (the App Router enables it by default), and
// concurrent hook instances can race the same way — either way, more than one
// caller can see `accessToken === null` before the first exchange resolves.
// Without this, each would fire its own `POST /auth/refresh` with the SAME
// token, which `auth.service.ts`'s compare-and-set rotation treats as theft
// and revokes the whole family.
let inFlight: Promise<TokenPair> | null = null

function exchangeOnce(auth: AuthApi, refreshToken: string): Promise<TokenPair> {
  if (!inFlight) {
    inFlight = auth.refresh(refreshToken).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

/**
 * Exchanges a surviving refresh token for a session on load.
 *
 * Only the exchange lives here. Fetching the principal is SWR's job — the
 * `session` key turns non-null the moment an access token lands, so there is no
 * second step to sequence and no way for the two to disagree.
 */
export function useSessionBootstrap(hydrated: boolean): void {
  const { auth } = useApi()

  useEffect(() => {
    if (!hydrated) return

    const store = useSessionStore.getState()
    // Already signed in (e.g. a second racing invocation resolved first).
    if (store.accessToken) return
    // Nothing to resume. `settling` is false, which is what opens the gate.
    if (!store.refreshToken) return

    store.setRefreshing(true)

    // No `cancelled` guard on any branch, and no cleanup function to set one:
    // this writes to a module-global zustand store, not component state, so
    // "don't set state after unmount" does not apply — and skipping it would
    // be actively harmful. `auth.service.ts` rotates the refresh token on a
    // compare-and-set, so by the time `.then` fires the exchange has ALREADY
    // succeeded server-side; discarding the new pair would leave the OLD,
    // now-dead token as the only one `partialize` persists, and the next load
    // sends it, gets read as reuse, and has the whole family revoked. The
    // same logic applies to `.catch`: skipping it leaves a token we know is
    // bad, which the next load would just burn for nothing. Clearing is the
    // honest outcome either way.
    void exchangeOnce(auth, store.refreshToken)
      .then((pair) => useSessionStore.getState().setTokens(pair))
      .catch(() => useSessionStore.getState().clear())
      .finally(() => useSessionStore.getState().setRefreshing(false))
  }, [hydrated, auth])
}
