"use client"

import { useEffect } from "react"
import { useApi } from "@/lib/api/provider"
import { useAuthStore } from "@/stores/auth.store"
import { useWindowStore } from "@/stores/window.store"

function openAuth(): void {
  useWindowStore.getState().openWindow({ kind: "auth", title: "Access", modal: true })
}

/**
 * On load: if a refresh token survived in storage, exchange it for a session
 * before deciding whether to show the auth window. Without this every reload
 * would bounce a signed-in user back to the login dialog.
 */
export function useSessionBootstrap(): void {
  const { auth } = useApi()

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const store = useAuthStore.getState()

      // Already signed in (e.g. React strict-mode double-invoke).
      if (store.accessToken && store.principal) return

      const persisted = store.readPersistedRefresh()
      if (!persisted) {
        openAuth()
        return
      }

      store.setStatus("loading")
      try {
        const pair = await auth.refresh(persisted)
        if (cancelled) return
        useAuthStore.getState().setTokens(pair)

        const principal = await auth.me()
        if (cancelled) return
        useAuthStore.getState().setPrincipal(principal)
      } catch {
        if (cancelled) return
        useAuthStore.getState().clear()
        openAuth()
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [auth])
}
