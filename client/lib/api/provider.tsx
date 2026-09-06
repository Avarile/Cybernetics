"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useAuthStore } from "@/stores/auth.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
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
      // Design §5.3: on refresh failure, clear both tokens and close every
      // window. Tearing down the workspace without this left the user on a
      // dimmed, inert canvas with no way back in short of a reload —
      // useAuthWindow now raises the gate off the cleared store.
      onAuthFailure: () => {
        useAuthStore.getState().clear()
        useWorkspaceStore.getState().closeAll()
      },
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
