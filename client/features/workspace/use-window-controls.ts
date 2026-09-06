"use client"

import type { Rect } from "@/lib/windows/types"
import { useWorkspaceStore } from "@/stores/workspace.store"

/** The six per-window actions, bound to one window's id. */
export function useWindowControls(id: string) {
  const closeWindow = useWorkspaceStore((s) => s.closeWindow)
  const focusWindow = useWorkspaceStore((s) => s.focusWindow)
  const minimiseWindow = useWorkspaceStore((s) => s.minimiseWindow)
  const restoreWindow = useWorkspaceStore((s) => s.restoreWindow)
  const toggleMaximiseWindow = useWorkspaceStore((s) => s.toggleMaximise)
  const moveWindow = useWorkspaceStore((s) => s.moveWindow)

  return {
    close: () => closeWindow(id),
    focus: () => focusWindow(id),
    minimise: () => minimiseWindow(id),
    restore: () => restoreWindow(id),
    toggleMaximise: () => toggleMaximiseWindow(id),
    move: (rect: Rect) => moveWindow(id, rect),
  }
}
