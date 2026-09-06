"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useAuthStore } from "@/stores/auth.store"
import { createApiClient, type ApiClient } from "./client"
import { createAuthApi, type AuthApi } from "./endpoints/auth"

interface ApiContextValue {
  client: ApiClient
  auth: AuthApi
}

const ApiContext = createContext<ApiContextValue | null>(null)

/**
 * Builds the one API client for the app and hands it the auth store as its
 * token source. Reading through `useAuthStore.getState()` rather than a hook
 * subscription is deliberate: the client must see the current token at call
 * time, and must not re-create itself whenever the token rotates.
 */
export function ApiProvider({
  children,
  baseUrl,
  fetchImpl,
}: {
  children: ReactNode
  baseUrl?: string
  fetchImpl?: typeof fetch
}) {
  const value = useMemo<ApiContextValue>(() => {
    const client = createApiClient({
      baseUrl: baseUrl ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () =>
        useAuthStore.getState().refreshToken ?? useAuthStore.getState().readPersistedRefresh(),
      onTokens: (pair) => useAuthStore.getState().setTokens(pair),
      onAuthFailure: () => useAuthStore.getState().clear(),
      fetchImpl,
    })
    return { client, auth: createAuthApi(client) }
  }, [baseUrl, fetchImpl])

  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error("useApi must be used inside <ApiProvider>")
  return ctx
}
