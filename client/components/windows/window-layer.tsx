"use client"

import { Suspense, useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { Spinner } from "@/components/ui/spinner"
import { WINDOW_REGISTRY } from "@/lib/windows/registry"
import { useViewportStore } from "@/stores/viewport.store"
import {
  MODAL_SCRIM_Z,
  selectOpenWindows,
  selectTopModal,
  useWorkspaceStore,
} from "@/stores/workspace.store"
import { WindowFrame } from "./window-frame"

export function WindowLayer() {
  // useShallow is required, not stylistic: selectOpenWindows filters and sorts,
  // so it returns a NEW array reference on every call. Under zustand v5 that
  // fails the getSnapshot identity check and re-renders forever.
  const windows = useWorkspaceStore(useShallow(selectOpenWindows))
  const topModal = useWorkspaceStore(selectTopModal)

  const closeWindow = useWorkspaceStore((st) => st.closeWindow)
  const focusWindow = useWorkspaceStore((st) => st.focusWindow)
  const minimiseWindow = useWorkspaceStore((st) => st.minimiseWindow)
  const toggleMaximise = useWorkspaceStore((st) => st.toggleMaximise)
  const moveWindow = useWorkspaceStore((st) => st.moveWindow)
  const setViewport = useViewportStore((st) => st.setViewport)

  // The store clamps rects against the viewport, so it has to know its size.
  useEffect(() => {
    const sync = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    sync()
    window.addEventListener("resize", sync)
    return () => window.removeEventListener("resize", sync)
  }, [setViewport])

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
      {windows.map((win) => {
        const descriptor = WINDOW_REGISTRY[win.kind]
        // A kind declared but not yet registered simply does not render.
        if (!descriptor) return null
        const Body = descriptor.component

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
        if (descriptor.chrome === "none") {
          return (
            <div
              key={win.id}
              style={{ zIndex: win.zIndex }}
              className="absolute inset-0 overflow-y-auto"
            >
              <div className="flex min-h-full items-center justify-center p-4 sm:p-6 md:p-10">
                <div
                  role="dialog"
                  aria-modal={win.modal || undefined}
                  aria-label={win.title}
                  onPointerDown={() => focusWindow(win.id)}
                  className="pointer-events-auto w-full max-w-sm"
                >
                  {body}
                </div>
              </div>
            </div>
          )
        }

        return (
          <div key={win.id} className="pointer-events-auto">
            <WindowFrame
              window={win}
              onClose={() => closeWindow(win.id)}
              onFocus={() => focusWindow(win.id)}
              onMinimise={() => minimiseWindow(win.id)}
              onToggleMaximise={() => toggleMaximise(win.id)}
              onMove={(rect) => moveWindow(win.id, rect)}
            >
              {body}
            </WindowFrame>
          </div>
        )
      })}
    </div>
  )
}
