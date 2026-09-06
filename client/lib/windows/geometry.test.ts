import { describe, expect, it } from "vitest"
import { CASCADE_STEP, cascade, clampToViewport } from "./geometry"

const VIEWPORT = { w: 1400, h: 900 }
const BASE = { x: 80, y: 80, w: 900, h: 600 }

describe("cascade", () => {
  it("returns the base rect for the first window", () => {
    expect(cascade(0, BASE, VIEWPORT)).toEqual(BASE)
  })

  it("offsets each subsequent window", () => {
    const second = cascade(1, BASE, VIEWPORT)
    expect(second.x).toBe(BASE.x + CASCADE_STEP)
    expect(second.y).toBe(BASE.y + CASCADE_STEP)
  })

  it("wraps rather than marching off-screen", () => {
    const far = cascade(50, BASE, VIEWPORT)
    expect(far.x + far.w).toBeLessThanOrEqual(VIEWPORT.w)
    expect(far.y + far.h).toBeLessThanOrEqual(VIEWPORT.h)
  })
})

describe("clampToViewport", () => {
  it("leaves a fitting rect alone", () => {
    expect(clampToViewport(BASE, VIEWPORT)).toEqual(BASE)
  })

  it("pulls a rect back inside the right/bottom edges", () => {
    const r = clampToViewport({ x: 1350, y: 880, w: 900, h: 600 }, VIEWPORT)
    expect(r.x + r.w).toBeLessThanOrEqual(VIEWPORT.w)
    expect(r.y + r.h).toBeLessThanOrEqual(VIEWPORT.h)
  })

  it("never produces negative coordinates", () => {
    const r = clampToViewport({ x: -400, y: -400, w: 300, h: 200 }, VIEWPORT)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
  })

  it("shrinks a window larger than the viewport", () => {
    const r = clampToViewport({ x: 0, y: 0, w: 3000, h: 2000 }, VIEWPORT)
    expect(r.w).toBeLessThanOrEqual(VIEWPORT.w)
    expect(r.h).toBeLessThanOrEqual(VIEWPORT.h)
  })

  it("survives a degenerate viewport without producing NaN", () => {
    const r = clampToViewport(BASE, { w: 0, h: 0 })
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
    expect(Number.isFinite(r.w)).toBe(true)
    expect(Number.isFinite(r.h)).toBe(true)
    expect(r.w).toBeGreaterThan(0)
    expect(r.h).toBeGreaterThan(0)
  })
})
