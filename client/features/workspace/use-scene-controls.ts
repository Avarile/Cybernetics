"use client"

import { useSceneStore } from "@/stores/scene.store"

/**
 * Thin pass-through over the scene store: the three System Core viewport
 * controls (module panel, scanner deck, camera reset).
 */
export function useSceneControls() {
  const panelOpen = useSceneStore((s) => s.panelOpen)
  const scannerVisible = useSceneStore((s) => s.scannerVisible)
  const resetToken = useSceneStore((s) => s.resetToken)
  const togglePanel = useSceneStore((s) => s.togglePanel)
  const toggleScanner = useSceneStore((s) => s.toggleScanner)
  const resetView = useSceneStore((s) => s.resetView)
  return { panelOpen, scannerVisible, resetToken, togglePanel, toggleScanner, resetView }
}
