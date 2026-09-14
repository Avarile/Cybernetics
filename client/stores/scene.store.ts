import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

interface SceneState {
  panelOpen: boolean
  /** Bumped to ask the canvas for a camera reset; it has no readable value. */
  resetToken: number
  togglePanel: () => void
  resetView: () => void
  reset: () => void
}

// The panel starts closed. It is a 320px rail over a scene that is the point of
// the page, and opening it by default spent a third of the viewport before the
// user had asked for anything.
const DEFAULTS = { panelOpen: false, resetToken: 0 }

/**
 * The System Core viewport controls, previously `useState` in CoreShell and
 * prop-drilled into two children.
 *
 * Not persisted, and deliberately not part of the workspace store: a persisted
 * store writes on every set, and toggling a panel has no business rewriting the
 * window layout. Not persisting is also what makes the closed default hold on
 * every visit rather than only the first.
 */
export const useSceneStore = create<SceneState>()(
  immer((set) => ({
    ...DEFAULTS,
    togglePanel: () =>
      set((state) => {
        state.panelOpen = !state.panelOpen
      }),
    resetView: () =>
      set((state) => {
        state.resetToken += 1
      }),
    reset: () => set(() => ({ ...DEFAULTS })),
  })),
)
