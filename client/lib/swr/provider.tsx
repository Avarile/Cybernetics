"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react"
import { SWRConfig, useSWRConfig } from "swr"
import { createApiClient, type ApiClient } from "@/lib/api/client"
import { createAuthApi, type AuthApi } from "@/lib/api/endpoints/auth"
import { useSessionStore } from "@/stores/session.store"
import { createFetcher } from "./fetcher"

interface ApiContextValue {
  client: ApiClient
  auth: AuthApi
}

const ApiContext = createContext<ApiContextValue | null>(null)

type Mutator = ReturnType<typeof useSWRConfig>["mutate"]

/**
 * Hands the out-of-React auth-failure path a way to reach the cache.
 *
 * `onAuthFailure` fires from inside the API client, which lives above SWRConfig
 * and has no hook context. SWR's global `mutate` is not an option either: it
 * targets the default cache, and tests deliberately install their own provider.
 */
function CacheBridge({ onReady }: { onReady: (mutate: Mutator) => void }) {
  const { mutate } = useSWRConfig()
  // An effect, not a render-phase call: writing during render is a side effect
  // React is free to double-invoke or discard.
  //
  // Ordering is safe, though NOT because of sibling render order — SWR starts
  // fetches from a layout effect, and React flushes every layout effect before
  // any passive one, so a child's fetch can begin before this runs. What makes
  // it safe is that `onAuthFailure` can only fire from a 401 *response*, which
  // arrives asynchronously, strictly after this commit's passive effects have
  // flushed. The ref is therefore always set before the callback can be reached.
  useEffect(() => {
    onReady(mutate)
  }, [mutate, onReady])
  return null
}

/**
 * The one place the API client, the SWR cache, and the stores are wired
 * together.
 *
 * `onAuthFailure` is a prop rather than a store reach-in, so `lib/api` no longer
 * imports a store and Ring 0 stops depending on Ring 1.
 */
export function StateProvider({
  children,
  baseUrl,
  fetchImpl,
  onAuthFailure,
}: {
  children: ReactNode
  baseUrl?: string
  fetchImpl?: typeof fetch
  // Design §5.3: on refresh failure, the caller must clear both tokens and
  // close every window. Tearing down the workspace without this left the user
  // on a dimmed, inert canvas with no way back in short of a reload —
  // useAuthGate raises the gate off the cleared store. The wiring that does
  // both (resetClientState) is injected here rather than baked in, so this
  // module does not have to import every store it needs to clear.
  onAuthFailure?: (mutate: Mutator | null) => void
}) {
  const mutateRef = useRef<Mutator | null>(null)
  const onReady = useCallback((mutate: Mutator) => {
    mutateRef.current = mutate
  }, [])

  const value = useMemo<ApiContextValue>(() => {
    // The rule reports the whole createApiClient() call below rather than the
    // one ref access inside it (in onAuthFailure): that closure is invoked by
    // the API client after an auth failure, never during render, but the rule
    // can't see that and flags any `.current` access in render-phase code.
    // eslint-disable-next-line react-hooks/refs
    const client = createApiClient({
      baseUrl: baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
      // Read through getState() rather than a subscription: the client must see
      // the current token at call time, and must not re-create itself whenever
      // the token rotates.
      getAccessToken: () => useSessionStore.getState().accessToken,
      // No persisted-storage fallback here (there used to be one): the store
      // now uses zustand `persist`, and `useStateHydration()` rehydrates it
      // before `useSessionBootstrap` ever reads `refreshToken` or attempts an
      // exchange. `setTokens` is also the only thing that ever sets
      // `accessToken`, and it always sets `refreshToken` in the same call — so
      // by the time any request could 401 on an access token, the in-memory
      // refresh token is already there. See use-session-bootstrap.test.tsx for
      // the test that pins this down.
      getRefreshToken: () => useSessionStore.getState().refreshToken,
      onTokens: (pair) => useSessionStore.getState().setTokens(pair),
      onAuthFailure: () => onAuthFailure?.(mutateRef.current),
      fetchImpl,
    })
    return { client, auth: createAuthApi(client) }
  }, [baseUrl, fetchImpl, onAuthFailure])

  return (
    <ApiContext.Provider value={value}>
      <SWRConfig
        value={{
          fetcher: createFetcher(value.client),
          revalidateOnFocus: false,
          // client.ts already owns the only retry that matters (401 → refresh →
          // one retry). Retrying on top of it multiplies requests against a
          // backend that treats two concurrent refreshes as token theft.
          shouldRetryOnError: false,
          dedupingInterval: 2000,
          // No global `keepPreviousData`. It exists for exactly one hook —
          // `useDomainTable`, which sets it itself — and as a default it points
          // the wrong way: every hook whose key identifies WHICH entity is on
          // screen has to remember to opt out, and three of them once didn't.
          // SWR's laggy-data ref has no guard for a null key, so the failures
          // are a cross-user principal leak and "New chat" showing the previous
          // transcript, not a cosmetic flicker.
        }}
      >
        <CacheBridge onReady={onReady} />
        {children}
      </SWRConfig>
    </ApiContext.Provider>
  )
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error("useApi must be used inside <StateProvider>")
  return ctx
}
