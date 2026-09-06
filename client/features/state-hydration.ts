"use client"

import { useEffect, useState } from "react"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"

/**
 * Rehydrates the persisted stores, and reports when they are ready.
 *
 * Both stores set `skipHydration`, so nothing is read from localStorage during
 * render — which is what keeps the server-rendered HTML and the first client
 * render identical. Everything that depends on persisted state waits on the
 * boolean this returns, which turns the old "order is load-bearing" comment in
 * CoreShell into a dependency a test can assert.
 */
export function useStateHydration(): boolean {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      useSessionStore.persist.rehydrate(),
      useWorkspaceStore.persist.rehydrate(),
    ]).then(() => {
      if (!cancelled) setHydrated(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return hydrated
}
