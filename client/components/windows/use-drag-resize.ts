"use client"

import { useCallback, useRef, useState } from "react"
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

  const begin = useCallback(
    (e: ReactPointerEvent, transform: (start: Rect, d: Delta) => Rect) => {
      if (disabled || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()

      const target = e.currentTarget as HTMLElement
      target.setPointerCapture?.(e.pointerId)
      origin.current = { x: e.clientX, y: e.clientY, rect }

      const onMove = (ev: PointerEvent) => {
        const o = origin.current
        if (!o) return
        setLiveRect(transform(o.rect, { dx: ev.clientX - o.x, dy: ev.clientY - o.y }))
      }

      const onUp = (ev: PointerEvent) => {
        const o = origin.current
        if (o) {
          onCommit(transform(o.rect, { dx: ev.clientX - o.x, dy: ev.clientY - o.y }))
        }
        origin.current = null
        setLiveRect(null)
        target.releasePointerCapture?.(ev.pointerId)
        window.removeEventListener("pointermove", onMove)
        window.removeEventListener("pointerup", onUp)
        window.removeEventListener("pointercancel", onUp)
      }

      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", onUp)
      // A cancelled pointer (browser gesture, focus loss) would otherwise leave
      // the listeners attached and the window stuck to the cursor.
      window.addEventListener("pointercancel", onUp)
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
