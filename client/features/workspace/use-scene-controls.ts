"use client"

import { useSceneStore } from "@/stores/scene.store"

/**
 * Thin pass-through over the scene store: the System Core viewport controls
 * (module panel, camera reset).
 */
export function useSceneControls() {
  const panelOpen = useSceneStore((s) => s.panelOpen)
  const resetToken = useSceneStore((s) => s.resetToken)
  const togglePanel = useSceneStore((s) => s.togglePanel)
  const resetView = useSceneStore((s) => s.resetView)
  return { panelOpen, resetToken, togglePanel, resetView }
}
