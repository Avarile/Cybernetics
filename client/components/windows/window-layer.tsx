"use client"

import { Suspense, useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { Spinner } from "@/components/ui/spinner"
import { WINDOW_REGISTRY } from "@/lib/windows/registry"
import {
  MODAL_SCRIM_Z,
  selectOpenWindows,
  selectTopModal,
  useWindowStore,
} from "@/stores/window.store"
import { WindowFrame } from "./window-frame"

export function WindowLayer() {
  // useShallow is required, not stylistic: selectOpenWindows filters and sorts,
  // so it returns a NEW array reference on every call. Under zustand v5 that
  // fails the getSnapshot identity check and re-renders forever.
  const windows = useWindowStore(useShallow(selectOpenWindows))
  const topModal = useWindowStore(selectTopModal)

  const closeWindow = useWindowStore((st) => st.closeWindow)
  const focusWindow = useWindowStore((st) => st.focusWindow)
  const minimiseWindow = useWindowStore((st) => st.minimiseWindow)
  const toggleMaximise = useWindowStore((st) => st.toggleMaximise)
  const moveWindow = useWindowStore((st) => st.moveWindow)
  const setViewport = useWindowStore((st) => st.setViewport)

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
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center">
                    <Spinner />
                  </div>
                }
              >
                <Body {...(win.props ?? {})} kind={win.kind} />
              </Suspense>
            </WindowFrame>
          </div>
        )
      })}
    </div>
  )
}
