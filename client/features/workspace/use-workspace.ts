"use client"

import { useEffect, useRef } from "react"
import { useShallow } from "zustand/react/shallow"
import { selectMinimised, selectOpenWindows, selectTopModal, useWorkspaceStore } from "@/stores/workspace.store"
import { useViewportStore } from "@/stores/viewport.store"

/**
 * The open workspace: windows in z-order, the minimised dock, and whichever
 * modal currently owns the scrim.
 */
export function useWorkspace() {
  // useShallow is required, not stylistic: these selectors filter and sort, so
  // they return a NEW array reference on every call. Under zustand v5 that
  // fails the getSnapshot identity check and re-renders forever.
  const windows = useWorkspaceStore(useShallow(selectOpenWindows))
  const minimised = useWorkspaceStore(useShallow(selectMinimised))
  const topModal = useWorkspaceStore(selectTopModal)
  const openWindow = useWorkspaceStore((s) => s.openWindow)
  return { windows, minimised, topModal, openWindow }
}

/**
 * Keeps the viewport store in step with the window, one write per frame.
 *
 * `resize` fires far faster than a frame while a window edge is dragged, and
 * every write re-renders every WindowFrame subscribed to the workspace store
 * — so an unthrottled listener meant a render storm during a drag, not (as it
 * might look) an unthrottled localStorage write: the viewport store below is
 * plain `create` + `immer`, with no `persist`, so nothing here ever touches
 * localStorage. The rAF coalesces a burst of resize events into one write
 * per animation frame.
 */
export function useViewportSync(): void {
  const frame = useRef<number | null>(null)

  useEffect(() => {
    const sync = () => {
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        useViewportStore.getState().setViewport({ w: window.innerWidth, h: window.innerHeight })
      })
    }

    sync()
    window.addEventListener("resize", sync)
    return () => {
      window.removeEventListener("resize", sync)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])
}
