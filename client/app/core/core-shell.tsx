"use client"

import { ShellChrome } from "@/components/shell/shell-chrome"
import { SystemCoreCanvas } from "@/components/system-core/system-core-canvas"
import { WindowLayer } from "@/components/windows/window-layer"
import { useAuthGate } from "@/features/session/use-auth-gate"
import { useSession } from "@/features/session/use-session"
import { useSessionBootstrap } from "@/features/session/use-session-bootstrap"
import { useStateHydration } from "@/features/state-hydration"
import { useSceneControls } from "@/features/workspace/use-scene-controls"
import { useHasOpenWindows } from "@/features/workspace/use-workspace"
import { cn } from "@/lib/utils"

export function CoreShell() {
  // Persisted state first: the gate must decide against a restored workspace,
  // and the bootstrap must see a rehydrated refresh token.
  const hydrated = useStateHydration()
  useSessionBootstrap(hydrated)
  useAuthGate(hydrated)

  const { authed } = useSession()

  const { panelOpen, resetToken } = useSceneControls()

  // An open window means the canvas is being looked past, not at. The scene
  // renders `frameloop="always"` at dpr up to 2 across the whole viewport, and
  // at full rate it competes for the main thread with exactly the re-renders a
  // data table is doing — so it drops to half cadence and a lower dpr.
  //
  // Reduced, not stopped: this used to pause the render loop, which was wrong
  // in every case it fired. No window ever covers the canvas (`clampToViewport`
  // keeps every rect inside a 16px margin and there is no maximised state), the
  // modal scrim is deliberately translucent so the machine stays visible behind
  // a dialog, and the auth gate is itself a window — so a paused loop froze the
  // stack on the login screen, which is the one place it is pure decoration.
  //
  // A boolean, not `useWorkspace().windows`: that selector sorts and allocates
  // a new array per call, so subscribing to it re-rendered this whole subtree
  // on every drag frame, focus change and prop patch.
  const backgrounded = useHasOpenWindows()

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#00001c]">
      {/*
        The stage colour is hard-coded rather than themed, matching the
        reference's STAGE_BACKGROUND: the canvas is exempt from theme tokens,
        because emissive materials only read as light against a dark ground.

        Signed out, the machine is dimmed and inert behind the auth dialog —
        visibly there, just not yours yet.
      */}
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-700",
          authed ? "opacity-100" : "pointer-events-none opacity-40",
        )}
      >
        <SystemCoreCanvas
          // The deck is the stack's floor, not a view option: it used to have a
          // toolbar toggle and that slot is the full-screen button now.
          scannerVisible
          panelOpen={authed && panelOpen}
          resetToken={resetToken}
          active={authed}
          backgrounded={backgrounded}
        />
      </div>

      <WindowLayer />
      <ShellChrome />
    </main>
  )
}
