"use client"

import { useCallback, useState } from "react"
import { ShellChrome } from "@/components/shell/shell-chrome"
import { useSessionBootstrap } from "@/components/shell/use-session-bootstrap"
import { SystemCoreCanvas } from "@/components/system-core/system-core-canvas"
import { Dock } from "@/components/windows/dock"
import { useWindowPersistence } from "@/components/windows/use-window-persistence"
import { WindowLayer } from "@/components/windows/window-layer"
import { cn } from "@/lib/utils"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"

export function CoreShell() {
  // Before the session bootstrap, so a restored layout is already in the store
  // when the auth window decides whether to open over it.
  useWindowPersistence()
  useSessionBootstrap()
  const authed = useAuthStore(selectIsAuthenticated)

  // The reference's three viewport controls, same defaults.
  const [panelOpen, setPanelOpen] = useState(true)
  const [scannerVisible, setScannerVisible] = useState(true)
  const [resetToken, setResetToken] = useState(0)

  const togglePanel = useCallback(() => setPanelOpen((v) => !v), [])
  const toggleScanner = useCallback(() => setScannerVisible((v) => !v), [])
  const resetView = useCallback(() => setResetToken((n) => n + 1), [])

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
      <ShellChrome
        panelOpen={panelOpen}
        scannerVisible={scannerVisible}
        onTogglePanel={togglePanel}
        onToggleScanner={toggleScanner}
        onResetView={resetView}
      />
      <Dock />
    </main>
  )
}
