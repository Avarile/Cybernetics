"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import type { Rect } from "@/lib/windows/types"

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

export interface Delta {
  dx: number
  dy: number
}

export interface Size {
  w: number
  h: number
}

const DEFAULT_MIN: Size = { w: 320, h: 200 }

/**
 * Things a pointer-down must reach instead of starting a drag.
 *
 * The window controls live INSIDE the title bar, which is the drag handle, so
 * their pointer-down bubbles to `begin` below. That used to be fatal rather
 * than merely untidy: `begin` calls `setPointerCapture` on the handle, and
 * pointer capture retargets every later pointer event — `pointerup` included —
 * to the capturing element. The browser then dispatches `click` at the nearest
 * common ancestor of the down and up targets, i.e. the title bar, so the
 * button's own `onClick` was never reached and the close button did nothing.
 *
 * jsdom implements neither pointer capture nor click retargeting, which is why
 * `window-frame.test.tsx` clicked all three controls and passed throughout.
 */
const INTERACTIVE = "button, a, input, select, textarea, [role='button'], [data-no-drag]"

/** Pure: translate a rect. */
export function applyDrag(rect: Rect, d: Delta): Rect {
  return { ...rect, x: rect.x + d.dx, y: rect.y + d.dy }
}

/**
 * Pure: resize from one handle.
 *
 * North and west handles move the origin as well as the size. They are
 * computed from the fixed opposite edge so that hitting the minimum size stops
 * the drag dead rather than letting the window creep across the screen.
 */
export function applyResize(
  rect: Rect,
  handle: ResizeHandle,
  d: Delta,
  min: Size = DEFAULT_MIN,
): Rect {
  let { x, y, w, h } = rect

  if (handle.includes("e")) w = Math.max(min.w, w + d.dx)
  if (handle.includes("s")) h = Math.max(min.h, h + d.dy)

  if (handle.includes("w")) {
    const right = x + w
    const nextW = Math.max(min.w, w - d.dx)
    x = right - nextW
    w = nextW
  }
  if (handle.includes("n")) {
    const bottom = y + h
    const nextH = Math.max(min.h, h - d.dy)
    y = bottom - nextH
    h = nextH
  }

  return { x, y, w, h }
}

export interface UseDragResize {
  liveRect: Rect
  isInteracting: boolean
  dragProps: { onPointerDown: (e: ReactPointerEvent) => void }
  resizeProps: (handle: ResizeHandle) => {
    onPointerDown: (e: ReactPointerEvent) => void
  }
}

/**
 * Drag and resize as a live local rect, committed once on pointer-up.
 *
 * The in-progress rect deliberately does not go through the store: writing to
 * zustand on every pointermove would re-render every window in the layer at
 * pointer frequency.
 */
export function useDragResize(opts: {
  rect: Rect
  minSize?: Size
  disabled?: boolean
  onCommit: (rect: Rect) => void
}): UseDragResize {
  const { rect, minSize = DEFAULT_MIN, disabled = false, onCommit } = opts
  const [liveRect, setLiveRect] = useState<Rect | null>(null)
  const origin = useRef<{ x: number; y: number; rect: Rect } | null>(null)

  // Detaches whatever the gesture in flight attached. Held in a ref so the
  // unmount effect below can reach it: the listeners live on `window`, and a
  // frame that closes mid-drag (Escape, a close from another window, a section
  // remount) would otherwise leave all three attached for the life of the page,
  // each retaining the DOM node, the origin rect and — through `onCommit` — the
  // whole component closure.
  const detach = useRef<(() => void) | null>(null)
  useEffect(() => () => detach.current?.(), [])

  const begin = useCallback(
    (e: ReactPointerEvent, transform: (start: Rect, d: Delta) => Rect) => {
      if (disabled || e.button !== 0) return
      // A pointer-down on one of the title bar's own controls is that control's
      // to handle. Returning BEFORE preventDefault and setPointerCapture is the
      // whole point — see INTERACTIVE above.
      if ((e.target as HTMLElement).closest?.(INTERACTIVE)) return

      e.preventDefault()
      // Deliberately NOT stopPropagation: the frame root's own `onPointerDown`
      // is what raises the window, and swallowing this event here meant
      // dragging a background window by its title bar never brought it forward.

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture?.(e.pointerId)
      origin.current = { x: e.clientX, y: e.clientY, rect }

      const onMove = (ev: PointerEvent) => {
        const o = origin.current
        if (!o) return
        setLiveRect(transform(o.rect, { dx: ev.clientX - o.x, dy: ev.clientY - o.y }))
      }

      const release = () => {
        origin.current = null
        setLiveRect(null)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
        detach.current = null
      }

      const onUp = (ev: PointerEvent) => {
        const o = origin.current
        const d = o ? { dx: ev.clientX - o.x, dy: ev.clientY - o.y } : null
        // A pointer that never moved is a click, not a gesture. Committing it
        // anyway wrote an identical rect back to the persisted workspace store
        // on every click of the title bar.
        if (o && d && (d.dx !== 0 || d.dy !== 0)) {
          onCommit(transform(o.rect, d))
        }
        target.releasePointerCapture?.(ev.pointerId)
        release()
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      // A cancelled pointer (browser gesture, focus loss) would otherwise leave
      // the listeners attached and the window stuck to the cursor.
      window.addEventListener("pointercancel", onUp)
      detach.current = release
    },
    [disabled, rect, onCommit],
  )

  return {
    liveRect: liveRect ?? rect,
    isInteracting: liveRect !== null,
    dragProps: {
      onPointerDown: (e) => begin(e, (start, d) => applyDrag(start, d)),
    },
    resizeProps: (handle) => ({
      onPointerDown: (e) => begin(e, (start, d) => applyResize(start, handle, d, minSize)),
    }),
  }
}
