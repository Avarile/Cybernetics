"use client"

import { Suspense } from "react"
import { Spinner } from "@/components/ui/spinner"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useViewportSync, useWorkspace } from "@/features/workspace/use-workspace"
import { WINDOW_META } from "@/lib/windows/meta"
import { WINDOW_COMPONENTS } from "@/lib/windows/registry"
import type { WindowInstance } from "@/lib/windows/types"
import { MODAL_SCRIM_Z } from "@/stores/workspace.store"
import { WindowFrame } from "./window-frame"

/**
 * One window's rendering, split out from WindowLayer because it needs
 * `useWindowControls(win.id)` — a hook, which cannot be called inside the
 * `.map()` below without breaking the rules of hooks across a list whose
 * length changes as windows open and close.
 */
function WindowItem({ win }: { win: WindowInstance }) {
  const { close, focus, minimise, toggleMaximise, move } = useWindowControls(win.id)
  const Body = WINDOW_COMPONENTS[win.kind]
  // A kind declared but not yet registered simply does not render.
  if (!Body) return null
  const meta = WINDOW_META[win.kind]

  const body = (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      }
    >
      {/* __windowId lets a body close itself — the confirm dialog
          dismisses on success without the opener holding a handle. */}
      <Body {...(win.props ?? {})} kind={win.kind} __windowId={win.id} />
    </Suspense>
  )

  // A chromeless window is centred here rather than placed by rect, and
  // gets no frame at all. The auth gate is the case: its body is already
  // a Card, so a frame around it is a box in a box, and its title bar
  // would offer a close button for a dialog that must not be dismissed.
  //
  // Centring is `min-h-full` inside a scrollable `inset-0` parent, not
  // `place-items-center`: on a short viewport (a phone in landscape) a
  // tall card then scrolls instead of being clipped at both ends. The
  // same classes also make it responsive without `useIsMobile`, so the
  // full-height mobile Sheet in WindowFrame never applies to a login.
  if (meta?.chrome === "none") {
    return (
      <div style={{ zIndex: win.zIndex }} className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4 sm:p-6 md:p-10">
          <div
            role="dialog"
            aria-modal={win.modal || undefined}
            aria-label={win.title}
            onPointerDown={focus}
            className="pointer-events-auto w-full max-w-sm"
          >
            {body}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-auto">
      <WindowFrame
        window={win}
        onClose={close}
        onFocus={focus}
        onMinimise={minimise}
        onToggleMaximise={toggleMaximise}
        onMove={move}
      >
        {body}
      </WindowFrame>
    </div>
  )
}

export function WindowLayer() {
  const { windows, topModal } = useWorkspace()
  useViewportSync()

  if (windows.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {topModal && (
        // A fixed dark scrim, not `bg-background/60`. What sits underneath is
        // always the theme-exempt dark canvas (design §4.3), so a themed scrim
        // washes it to grey in light mode and erases the machine behind the
        // dialog — the opposite of the intended "it's there, just not yours yet".
        //
        // The zIndex is load-bearing. Every window carries an explicit zIndex,
        // so a scrim with `auto` loses to all of them and dims nothing but the
        // canvas — non-modal windows kept painting over it at full brightness.
        // MODAL_Z_BASE - 1 puts it under the modal band and over everything else.
        <div
          style={{ zIndex: MODAL_SCRIM_Z }}
          className="pointer-events-auto absolute inset-0 bg-black/50 backdrop-blur-sm"
        />
      )}
      {windows.map((win) => (
        <WindowItem key={win.id} win={win} />
      ))}
    </div>
  )
}
