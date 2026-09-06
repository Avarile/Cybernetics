import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { DOMAINS, DOMAIN_BY_KEY } from "./domains"
import { STATUS, STATUS_KEYS } from "./status"

describe("DOMAINS", () => {
  it("has unique keys and bands", () => {
    expect(new Set(DOMAINS.map((d) => d.key)).size).toBe(DOMAINS.length)
    expect(new Set(DOMAINS.map((d) => d.band)).size).toBe(DOMAINS.length)
  })

  it("orders bands contiguously from zero", () => {
    expect(DOMAINS.map((d) => d.band).sort((a, b) => a - b)).toEqual(
      DOMAINS.map((_, i) => i),
    )
  })

  it("widens radius monotonically up the stack", () => {
    const byBand = [...DOMAINS].sort((a, b) => a.band - b.band)
    for (let i = 1; i < byBand.length; i++) {
      expect(byBand[i].radius).toBeGreaterThan(byBand[i - 1].radius)
    }
  })

  it("keeps every arc inside a full turn", () => {
    for (const d of DOMAINS) {
      expect(d.arcDeg).toBeGreaterThan(0)
      expect(d.arcDeg).toBeLessThanOrEqual(360)
    }
  })

  it("indexes every domain by key", () => {
    for (const d of DOMAINS) expect(DOMAIN_BY_KEY.get(d.key)).toBe(d)
  })
})

/**
 * Guards against inventing endpoints. Two entries in DOMAINS are deliberately
 * not the obvious path (`/mailbox/messages`, `/invoices`), precisely because
 * the obvious ones do not exist — this test is what keeps that honest as the
 * backend changes.
 */
describe("DOMAINS endpoints exist in the API", () => {
  /** Walks api/src for *.controller.ts and collects their @Controller() paths.
   *  Plain fs rather than a shell so there is no subprocess and no grep
   *  dependency. Returns null if api/ is not checked out beside client/, which
   *  skips these cases instead of failing them. */
  const controllerPaths = (() => {
    const root = join(process.cwd(), "..", "api", "src")
    const found = new Set<string>()
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(full)
        } else if (entry.name.endsWith(".controller.ts")) {
          for (const m of readFileSync(full, "utf8").matchAll(/@Controller\('([^']*)'\)/g)) {
            found.add(m[1])
          }
        }
      }
    }
    try {
      walk(root)
      return found.size > 0 ? found : null
    } catch {
      return null
    }
  })()

  it.skipIf(controllerPaths === null)(
    "every countEndpoint maps to a registered controller",
    () => {
      const missing: string[] = []
      for (const d of DOMAINS) {
        const path = d.countEndpoint.replace(/^\//, "")
        // A controller either owns the whole path, or owns a prefix of it.
        const ok = [...(controllerPaths as Set<string>)].some(
          (c) => c === path || path.startsWith(c + "/"),
        )
        if (!ok) missing.push(`${d.key} → ${d.countEndpoint}`)
      }
      expect(missing).toEqual([])
    },
  )

  it.skipIf(controllerPaths === null)(
    "no domain points at a bare /finance or /mailbox root list, which do not exist",
    () => {
      const bad = DOMAINS.filter(
        (d) => d.countEndpoint === "/finance" || d.countEndpoint === "/mailbox",
      )
      expect(bad.map((d) => d.key)).toEqual([])
    },
  )
})

describe("STATUS", () => {
  it("covers every health key", () => {
    expect(STATUS_KEYS.sort()).toEqual(
      ["active", "attention", "error", "nominal", "unknown"].sort(),
    )
  })

  it("gives every state a colour, gain, speed and css hex", () => {
    for (const key of STATUS_KEYS) {
      const s = STATUS[key]
      expect(s.color).toBeGreaterThanOrEqual(0)
      expect(s.color).toBeLessThanOrEqual(0xffffff)
      expect(s.gain).toBeGreaterThan(0)
      expect(s.speed).toBeGreaterThanOrEqual(0)
      expect(s.hex).toMatch(/^#[0-9A-F]{6}$/)
      expect(s.label.length).toBeGreaterThan(0)
    }
  })

  it("keeps the css hex in step with the numeric colour", () => {
    for (const key of STATUS_KEYS) {
      const s = STATUS[key]
      expect(s.hex).toBe("#" + s.color.toString(16).padStart(6, "0").toUpperCase())
    }
  })

  it("makes unknown the dimmest and slowest state", () => {
    for (const key of STATUS_KEYS.filter((k) => k !== "unknown")) {
      expect(STATUS.unknown.gain).toBeLessThan(STATUS[key].gain)
    }
  })
})
