"use client"

import { ShellChrome } from "@/components/shell/shell-chrome"
import { SystemCoreCanvas } from "@/components/system-core/system-core-canvas"
import { Dock } from "@/components/windows/dock"
import { WindowLayer } from "@/components/windows/window-layer"
import { useAuthGate } from "@/features/session/use-auth-gate"
import { useSession } from "@/features/session/use-session"
import { useSessionBootstrap } from "@/features/session/use-session-bootstrap"
import { useStateHydration } from "@/features/state-hydration"
import { useSceneControls } from "@/features/workspace/use-scene-controls"
import { cn } from "@/lib/utils"

export function CoreShell() {
  // Persisted state first: the gate must decide against a restored workspace,
  // and the bootstrap must see a rehydrated refresh token.
  const hydrated = useStateHydration()
  useSessionBootstrap(hydrated)
  useAuthGate(hydrated)

  const { authed } = useSession()

  // The reference's three viewport controls, same defaults.
  const { panelOpen, scannerVisible, resetToken } = useSceneControls()

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
          scannerVisible={scannerVisible}
          panelOpen={authed && panelOpen}
          resetToken={resetToken}
          active={authed}
        />
      </div>

      <WindowLayer />
      <ShellChrome />
      <Dock />
    </main>
  )
}
