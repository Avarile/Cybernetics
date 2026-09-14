"use client"

import type { JsonObject } from "@/lib/state/json"
import type { Rect } from "@/lib/windows/types"
import { useWorkspaceStore } from "@/stores/workspace.store"

/** The four per-window actions, bound to one window's id. */
export function useWindowControls(id: string) {
  const closeWindow = useWorkspaceStore((s) => s.closeWindow)
  const focusWindow = useWorkspaceStore((s) => s.focusWindow)
  const moveWindow = useWorkspaceStore((s) => s.moveWindow)
  const patchWindowProps = useWorkspaceStore((s) => s.patchWindowProps)

  return {
    close: () => closeWindow(id),
    focus: () => focusWindow(id),
    move: (rect: Rect) => moveWindow(id, rect),
    patchProps: (patch: JsonObject) => patchWindowProps(id, patch),
  }
}
