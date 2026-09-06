import { describe, expect, it } from "vitest"
import { applyDrag, applyResize } from "./use-drag-resize"

const RECT = { x: 100, y: 100, w: 600, h: 400 }
const MIN = { w: 320, h: 200 }

describe("applyDrag", () => {
  it("translates the rect by the pointer delta", () => {
    expect(applyDrag(RECT, { dx: 40, dy: -25 })).toEqual({ x: 140, y: 75, w: 600, h: 400 })
  })

  it("leaves the size untouched", () => {
    const r = applyDrag(RECT, { dx: 999, dy: 999 })
    expect(r.w).toBe(600)
    expect(r.h).toBe(400)
  })
})

describe("applyResize", () => {
  it("grows from the south-east handle", () => {
    expect(applyResize(RECT, "se", { dx: 50, dy: 30 }, MIN)).toEqual({
      x: 100,
      y: 100,
      w: 650,
      h: 430,
    })
  })

  it("moves the origin when resizing from the north-west handle", () => {
    expect(applyResize(RECT, "nw", { dx: 50, dy: 30 }, MIN)).toEqual({
      x: 150,
      y: 130,
      w: 550,
      h: 370,
    })
  })

  it("refuses to shrink below the minimum size", () => {
    const r = applyResize(RECT, "se", { dx: -900, dy: -900 }, MIN)
    expect(r.w).toBe(MIN.w)
    expect(r.h).toBe(MIN.h)
  })

  it("does not let a north-west resize push the origin past the minimum", () => {
    const r = applyResize(RECT, "nw", { dx: 900, dy: 900 }, MIN)
    expect(r.w).toBe(MIN.w)
    expect(r.h).toBe(MIN.h)
    // the opposite edges must stay put
    expect(r.x + r.w).toBe(RECT.x + RECT.w)
    expect(r.y + r.h).toBe(RECT.y + RECT.h)
  })

  it("resizes width only from the east handle", () => {
    expect(applyResize(RECT, "e", { dx: 40, dy: 500 }, MIN)).toEqual({
      x: 100,
      y: 100,
      w: 640,
      h: 400,
    })
  })

  it("resizes height only from the south handle", () => {
    expect(applyResize(RECT, "s", { dx: 500, dy: 40 }, MIN)).toEqual({
      x: 100,
      y: 100,
      w: 600,
      h: 440,
    })
  })

  it("keeps the right edge fixed when dragging the west handle", () => {
    const r = applyResize(RECT, "w", { dx: -60, dy: 0 }, MIN)
    expect(r.x).toBe(40)
    expect(r.w).toBe(660)
    expect(r.x + r.w).toBe(RECT.x + RECT.w)
  })
})
