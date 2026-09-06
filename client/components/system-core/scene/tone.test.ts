import { describe, expect, it } from "vitest"
import {
  emitterOffset,
  humLevel,
  mixGain,
  reach,
  roarCutoff,
  roarLevel,
  saturationCurve,
} from "./tone"

/**
 * The audio modules are ported verbatim from the reference. These tests do not
 * re-specify the sound design — they pin the properties the rest of the scene
 * relies on: everything is finite, levels stay inside the range the bus
 * expects, and distance attenuation is monotonic.
 */
describe("tone (ported)", () => {
  it("emitterOffset puts the voice out on the arc, not at the spin axis", () => {
    const [x, y, z] = emitterOffset(1.2, 180)
    expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
    expect(Math.hypot(x, z)).toBeCloseTo(1.2, 5)
  })

  it("emitterOffset stays on the band's own radius for any arc", () => {
    for (const arc of [30, 90, 180, 270, 360]) {
      const [x, , z] = emitterOffset(0.8, arc)
      expect(Math.hypot(x, z)).toBeCloseTo(0.8, 5)
    }
  })

  it("roarLevel is finite and never negative across a wide distance sweep", () => {
    for (let d = 0; d < 60; d += 0.5) {
      const level = roarLevel(d, 60, 1)
      expect(Number.isFinite(level)).toBe(true)
      expect(level).toBeGreaterThanOrEqual(0)
    }
  })

  it("roarLevel does not grow with distance", () => {
    const near = roarLevel(1, 60, 1)
    const far = roarLevel(40, 60, 1)
    expect(far).toBeLessThanOrEqual(near)
  })

  it("humLevel is finite, bounded and non-increasing with distance", () => {
    let prev = Infinity
    for (let d = 0; d < 60; d += 0.5) {
      const level = humLevel(d)
      expect(Number.isFinite(level)).toBe(true)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
      expect(level).toBeLessThanOrEqual(prev + 1e-9)
      prev = level
    }
  })

  it("roarCutoff returns a positive, finite filter frequency", () => {
    for (const level of [0, 0.25, 0.5, 1]) {
      const hz = roarCutoff(level)
      expect(Number.isFinite(hz)).toBe(true)
      expect(hz).toBeGreaterThan(0)
    }
  })

  it("mixGain stays finite and non-negative below nyquist", () => {
    for (const hz of [20, 60, 200, 1000, 8000]) {
      const g = mixGain(hz, 24000)
      expect(Number.isFinite(g)).toBe(true)
      expect(g).toBeGreaterThanOrEqual(0)
    }
  })

  it("reach returns a positive radius", () => {
    for (const centre of [30, 60, 120]) {
      expect(reach(centre)).toBeGreaterThan(0)
    }
  })

  it("saturationCurve is finite and within the -1..1 a WaveShaper needs", () => {
    const curve = saturationCurve()
    expect(curve.length).toBeGreaterThan(0)
    for (const v of curve) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
})
