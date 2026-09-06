"use client"

import { useCallback, useState } from "react"
import { ShellChrome } from "@/components/shell/shell-chrome"
import { useSessionBootstrap } from "@/components/shell/use-session-bootstrap"
import { SystemCoreCanvas } from "@/components/system-core/system-core-canvas"
import { Dock } from "@/components/windows/dock"
import { WindowLayer } from "@/components/windows/window-layer"
import { cn } from "@/lib/utils"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"

export function CoreShell() {
  useSessionBootstrap()
  const authed = useAuthStore(selectIsAuthenticated)

  const [scannerVisible, setScannerVisible] = useState(true)
  // Off by default: browsers refuse an AudioContext without a gesture, and an
  // unprompted drone on the landing surface is hostile. The toolbar turns it on.
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [resetToken, setResetToken] = useState(0)

  const toggleScanner = useCallback(() => setScannerVisible((v) => !v), [])
  const toggleSound = useCallback(() => setSoundEnabled((v) => !v), [])
  const resetView = useCallback(() => setResetToken((n) => n + 1), [])

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#00001c]">
      {/*
        The stage colour is hard-coded rather than themed, matching the
        reference's STAGE_BACKGROUND: per design 4.3 the canvas is exempt from
        theme tokens, because emissive materials only read as light against a
        dark ground in both themes.

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
          soundEnabled={authed && soundEnabled}
          resetToken={resetToken}
        />
      </div>

      <WindowLayer />
      <ShellChrome
        scannerVisible={scannerVisible}
        soundEnabled={soundEnabled}
        onToggleScanner={toggleScanner}
        onToggleSound={toggleSound}
        onResetView={resetView}
      />
      <Dock />
    </main>
  )
}
