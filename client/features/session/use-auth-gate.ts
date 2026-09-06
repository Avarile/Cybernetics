"use client"

import { useEffect } from "react"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useSession } from "./use-session"

/**
 * Returns an id rather than the instance, so the subscription compares by
 * identity without needing `useShallow` — the trap documented in
 * window-layer.tsx:16-18, where a selector returning a fresh object each call
 * re-renders forever under zustand v5.
 */
const selectGateId = (st: ReturnType<typeof useWorkspaceStore.getState>): string | null =>
  st.windows.find((w) => w.kind === "auth")?.id ?? null

/**
 * Makes the auth window derived state rather than something call sites remember
 * to open and close.
 *
 * It used to be purely imperative: the bootstrap and sign-out opened it, and
 * nothing closed it, so a successful login left the modal — and its
 * click-swallowing scrim — sitting over the app until a reload.
 *
 * Reconciling in one place fixes login, sign-out and mid-session expiry alike.
 */
export function useAuthGate(hydrated: boolean): void {
  const { authed, settling } = useSession()
  const gateId = useWorkspaceStore(selectGateId)

  useEffect(() => {
    if (!hydrated || settling) return

    const workspace = useWorkspaceStore.getState()
    if (authed) {
      if (gateId) workspace.closeWindow(gateId)
      return
    }
    if (!gateId) workspace.openWindow({ kind: "auth" })
  }, [hydrated, settling, authed, gateId])
}
