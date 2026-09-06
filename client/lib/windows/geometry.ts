import type { Rect } from "./types"

export const CASCADE_STEP = 24
const CASCADE_WRAP = 8
const MARGIN = 16

/** Floor so a collapsed or not-yet-measured viewport cannot produce a
 *  zero/negative-sized window. */
const MIN_DIMENSION = 160

export interface Viewport {
  w: number
  h: number
}

/** Offsets each new window so it does not land exactly on its predecessor. */
export function cascade(index: number, base: Rect, viewport: Viewport): Rect {
  const step = (index % CASCADE_WRAP) * CASCADE_STEP
  return clampToViewport({ ...base, x: base.x + step, y: base.y + step }, viewport)
}

/**
 * Keeps a rect fully on screen, shrinking it first if it cannot fit.
 *
 * Guarded against a degenerate viewport: during SSR and before the first
 * measurement `window.innerWidth` can be 0, and a naive
 * `viewport.w - MARGIN * 2` would hand back a negative width.
 */
export function clampToViewport(rect: Rect, viewport: Viewport): Rect {
  const availableW = Math.max(MIN_DIMENSION, viewport.w - MARGIN * 2)
  const availableH = Math.max(MIN_DIMENSION, viewport.h - MARGIN * 2)

  const w = Math.max(MIN_DIMENSION, Math.min(rect.w, availableW))
  const h = Math.max(MIN_DIMENSION, Math.min(rect.h, availableH))

  const x = Math.max(0, Math.min(rect.x, Math.max(0, viewport.w - w)))
  const y = Math.max(0, Math.min(rect.y, Math.max(0, viewport.h - h)))

  return { x, y, w, h }
}
