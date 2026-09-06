"use client"

import { ShellChrome } from "@/components/shell/shell-chrome"
import { useSessionBootstrap } from "@/components/shell/use-session-bootstrap"
import { Dock } from "@/components/windows/dock"
import { WindowLayer } from "@/components/windows/window-layer"
import { cn } from "@/lib/utils"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"

export function CoreShell() {
  useSessionBootstrap()
  const authed = useAuthStore(selectIsAuthenticated)

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#00001c]">
      {/*
        Phase 2 replaces this with the 3D canvas. The hard-coded near-black is
        deliberate and matches the reference's STAGE_BACKGROUND: per design §4.3
        the canvas is exempt from theme tokens, because emissive materials only
        read as light against a dark stage in both themes.
      */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 transition-opacity duration-700",
          authed ? "opacity-100" : "pointer-events-none opacity-40",
        )}
      >
        <div className="flex h-full items-center justify-center">
          <span className="text-xs tracking-[0.3em] text-white/20">SYSTEM CORE</span>
        </div>
      </div>

      <WindowLayer />
      <ShellChrome />
      <Dock />
    </main>
  )
}
