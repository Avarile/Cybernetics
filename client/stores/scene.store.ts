import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

interface SceneState {
  panelOpen: boolean
  scannerVisible: boolean
  /** Bumped to ask the canvas for a camera reset; it has no readable value. */
  resetToken: number
  togglePanel: () => void
  toggleScanner: () => void
  resetView: () => void
  reset: () => void
}

const DEFAULTS = { panelOpen: true, scannerVisible: true, resetToken: 0 }

/**
 * The three System Core viewport controls, previously `useState` in CoreShell
 * and prop-drilled into two children.
 *
 * Not persisted, and deliberately not part of the workspace store: a persisted
 * store writes on every set, and toggling a panel has no business rewriting the
 * window layout.
 */
export const useSceneStore = create<SceneState>()(
  immer((set) => ({
    ...DEFAULTS,
    togglePanel: () =>
      set((state) => {
        state.panelOpen = !state.panelOpen
      }),
    toggleScanner: () =>
      set((state) => {
        state.scannerVisible = !state.scannerVisible
      }),
    resetView: () =>
      set((state) => {
        state.resetToken += 1
      }),
    reset: () => set(() => ({ ...DEFAULTS })),
  })),
)
