import { describe, expect, it } from "vitest"
import { MaterialRegistry } from "./materials"

const RED = 0xff0000
const BLUE = 0x0000ff

describe("MaterialRegistry", () => {
  it("shares one material between modules that look alike", () => {
    const reg = new MaterialRegistry()
    const a = reg.forModule(RED, null, 1)
    const b = reg.forModule(RED, null, 1)
    expect(a.band).toBe(b.band)
    expect(a.glow).toBe(b.glow)
    reg.dispose()
  })

  it("gives differently-coloured modules their own band material", () => {
    const reg = new MaterialRegistry()
    expect(reg.forModule(RED, null, 1).band).not.toBe(reg.forModule(BLUE, null, 1).band)
    reg.dispose()
  })

  it("keys the band on gain but leaves the soft layers shared", () => {
    const reg = new MaterialRegistry()
    const dim = reg.forModule(RED, null, 0.5)
    const hot = reg.forModule(RED, null, 1.5)
    expect(dim.band).not.toBe(hot.band)
    // glow/halo/hot/mark key on gain 1, so they stay shared across gains
    expect(dim.glow).toBe(hot.glow)
    expect(dim.halo).toBe(hot.halo)
    reg.dispose()
  })

  it("dims the always-on materials and restores them exactly", () => {
    const reg = new MaterialRegistry()
    const m = reg.forModule(RED, null, 1)
    const base = m.band.emissiveIntensity

    reg.setDimmed(true)
    expect(m.band.emissiveIntensity).toBeLessThan(base)

    reg.setDimmed(false)
    expect(m.band.emissiveIntensity).toBe(base)
    reg.dispose()
  })

  it("leaves the selection overlays out of the dimming pass", () => {
    const reg = new MaterialRegistry()
    const m = reg.forModule(RED, null, 1)
    const hotBefore = m.hot.emissiveIntensity
    reg.setDimmed(true)
    expect(m.hot.emissiveIntensity).toBe(hotBefore)
    reg.dispose()
  })

  it("pulse only moves the selection materials", () => {
    const reg = new MaterialRegistry()
    const m = reg.forModule(RED, null, 1)
    const bandBefore = m.band.emissiveIntensity

    reg.pulse(0)
    const hotAt0 = m.hot.opacity
    reg.pulse(1000)

    expect(m.band.emissiveIntensity).toBe(bandBefore)
    expect(m.hot.opacity).not.toBe(hotAt0)
    reg.dispose()
  })

  it("keeps pulse opacity inside 0..1", () => {
    const reg = new MaterialRegistry()
    const m = reg.forModule(RED, null, 1)
    for (let t = 0; t < 4000; t += 137) {
      reg.pulse(t)
      expect(m.hot.opacity).toBeGreaterThanOrEqual(0)
      expect(m.hot.opacity).toBeLessThanOrEqual(1)
    }
    reg.dispose()
  })

  it("dispose() empties the registry so a later get() rebuilds", () => {
    const reg = new MaterialRegistry()
    const before = reg.forModule(RED, null, 1).band
    reg.dispose()
    const after = reg.forModule(RED, null, 1).band
    expect(after).not.toBe(before)
    reg.dispose()
  })
})
