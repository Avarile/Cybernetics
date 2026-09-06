import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import type { Viewport } from "@/lib/windows/geometry"

interface ViewportState extends Viewport {
  setViewport: (v: Viewport) => void
}

/**
 * The measured window size, kept out of the workspace store on purpose.
 *
 * `persist` writes after every `setState` with no diff against `partialize`
 * (zustand/esm/middleware.mjs:366), and the resize listener fires this many
 * times per drag — so leaving it in the persisted store meant serialising the
 * whole window array per resize event. Viewport is environment, not workspace.
 *
 * The default is a plausible desktop rather than zero: `clampToViewport` runs
 * before the first measurement, and a zero viewport collapses every window.
 */
export const useViewportStore = create<ViewportState>()(
  immer((set) => ({
    w: 1440,
    h: 900,
    setViewport: ({ w, h }) =>
      set((state) => {
        state.w = w
        state.h = h
      }),
  })),
)
