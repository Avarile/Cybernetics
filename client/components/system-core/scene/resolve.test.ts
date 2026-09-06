import { describe, expect, it } from "vitest"
import { DOMAINS } from "../data/domains"
import { STATUS, STATUS_KEYS } from "../data/status"
import { colorOf, gainOf, newRuntime, speedOf, stripSpec, yOf } from "./resolve"

const agent = DOMAINS[0]
const top = DOMAINS[DOMAINS.length - 1]

describe("resolve", () => {
  it("maps health to the status table's colour and gain", () => {
    for (const h of STATUS_KEYS) {
      expect(colorOf(h)).toBe(STATUS[h].color)
      expect(gainOf(h)).toBe(STATUS[h].gain)
    }
  })

  it("stacks bands upward without overlapping", () => {
    const ys = [...DOMAINS].sort((a, b) => a.band - b.band).map(yOf)
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]).toBeGreaterThan(ys[i - 1])
    }
  })

  it("keeps the stack inside the mainframe cap rings", () => {
    // config.MAINFRAME.capY is 1.55; bands must sit comfortably within.
    for (const d of DOMAINS) {
      expect(Math.abs(yOf(d))).toBeLessThan(1.5)
    }
  })

  it("spins an active domain faster than a nominal one, and error slowest", () => {
    expect(speedOf("active")).toBeGreaterThan(speedOf("nominal"))
    expect(speedOf("error")).toBeLessThan(speedOf("nominal"))
    expect(speedOf("unknown")).toBeLessThan(speedOf("nominal"))
  })

  it("never produces a negative or zero speed", () => {
    for (const h of STATUS_KEYS) expect(speedOf(h)).toBeGreaterThan(0)
  })

  it("builds a spec whose id is the domain key and label is its display name", () => {
    const spec = stripSpec(agent, "nominal")
    expect(spec.id).toBe("agent")
    expect(spec.label).toBe("Agent")
    expect(spec.radius).toBe(agent.radius)
    expect(spec.arcDeg).toBe(agent.arcDeg)
  })

  it("shows a trail only while a domain is active", () => {
    expect(stripSpec(agent, "active").trail).toBe(true)
    expect(stripSpec(agent, "nominal").trail).toBe(false)
    expect(stripSpec(agent, "error").trail).toBe(false)
  })

  it("assigns a distinct tone per band, quieter up the stack", () => {
    const tones = DOMAINS.map((d) => stripSpec(d, "nominal").tone)
    expect(new Set(tones).size).toBe(DOMAINS.length)
    expect(stripSpec(top, "nominal").toneLevel).toBeLessThan(
      stripSpec(agent, "nominal").toneLevel,
    )
  })

  it("keeps toneLevel inside the 0..1 the bus expects", () => {
    for (const d of DOMAINS) {
      const level = stripSpec(d, "nominal").toneLevel
      expect(level).toBeGreaterThan(0)
      expect(level).toBeLessThanOrEqual(1)
    }
  })

  it("gives every domain a distinct starting phase inside one turn", () => {
    const phases = DOMAINS.map((d) => newRuntime(d).phase)
    expect(new Set(phases).size).toBe(DOMAINS.length)
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(Math.PI * 2)
    }
  })

  it("is deterministic — two loads produce the same stack", () => {
    expect(DOMAINS.map((d) => newRuntime(d).phase)).toEqual(
      DOMAINS.map((d) => newRuntime(d).phase),
    )
  })
})
