"use client"

import { useEffect, useRef } from "react"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useSession } from "./use-session"

/**
 * Makes the auth window derived state rather than something call sites remember
 * to open and close.
 *
 * It used to be purely imperative: the bootstrap and sign-out opened it, and
 * nothing closed it, so a successful login left the modal — and its
 * click-swallowing scrim — sitting over the app until a reload.
 *
 * Reconciling in one place fixes login, sign-out and mid-session expiry alike.
 *
 * It reconciles ONCE per signed-out episode, not continuously. The earlier
 * version subscribed to the gate's id and re-opened the window the instant it
 * went missing, which is what made the gate the one window over the core that
 * could not be dismissed — a Close on it would have reopened itself in the
 * same tick. Offering it once leaves the user free to put it aside and look at
 * the (dimmed, inert) machine behind it; "Sign in" in the shell chrome summons
 * it back, and any later sign-out raises it again on its own.
 */
export function useAuthGate(hydrated: boolean): void {
  const { authed, settling } = useSession()
  // Whether this signed-out episode has already been offered the gate. A ref
  // rather than state or a store subscription: it must neither re-render nor
  // re-trigger the effect, and re-triggering on the gate's disappearance is
  // precisely the behaviour being removed.
  const offered = useRef(false)

  useEffect(() => {
    if (!hydrated || settling) return

    const workspace = useWorkspaceStore.getState()
    const gateId = workspace.windows.find((w) => w.kind === "auth")?.id ?? null

    if (authed) {
      if (gateId) workspace.closeWindow(gateId)
      // Re-arm: a sign-out, or an expiry, must raise the gate again.
      offered.current = false
      return
    }

    if (offered.current || gateId) return
    offered.current = true
    workspace.openWindow({ kind: "auth" })
  }, [hydrated, settling, authed])
}
