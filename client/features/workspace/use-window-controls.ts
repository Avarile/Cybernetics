"use client"

import type { JsonObject } from "@/lib/state/json"
import type { Rect } from "@/lib/windows/types"
import { useWorkspaceStore } from "@/stores/workspace.store"

/** The seven per-window actions, bound to one window's id. */
export function useWindowControls(id: string) {
  const closeWindow = useWorkspaceStore((s) => s.closeWindow)
  const focusWindow = useWorkspaceStore((s) => s.focusWindow)
  const minimiseWindow = useWorkspaceStore((s) => s.minimiseWindow)
  const restoreWindow = useWorkspaceStore((s) => s.restoreWindow)
  const toggleMaximiseWindow = useWorkspaceStore((s) => s.toggleMaximise)
  const moveWindow = useWorkspaceStore((s) => s.moveWindow)
  const patchWindowProps = useWorkspaceStore((s) => s.patchWindowProps)

  return {
    close: () => closeWindow(id),
    focus: () => focusWindow(id),
    minimise: () => minimiseWindow(id),
    restore: () => restoreWindow(id),
    toggleMaximise: () => toggleMaximiseWindow(id),
    move: (rect: Rect) => moveWindow(id, rect),
    patchProps: (patch: JsonObject) => patchWindowProps(id, patch),
  }
}
