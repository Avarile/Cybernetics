import { describe, expect, it } from "vitest"
import { DatabaseIcon } from "lucide-react"
import type { DomainSpec } from "./types"
import { resolveLocation, visibleDomains, visibleSections } from "./registry"

/**
 * A stand-in domain set.
 *
 * The real DOMAINS grows every increment; pinning these tests to it would make
 * every new domain a test edit. What is under test is the resolution rules,
 * not the contents.
 */
const stub = (over: Partial<DomainSpec> = {}): DomainSpec => ({
  key: "contacts",
  label: "Contacts",
  icon: DatabaseIcon,
  sections: [
    { key: "people", label: "People", body: { kind: "custom", render: () => null } },
    { key: "types", label: "Types", secondary: true, body: { kind: "custom", render: () => null } },
    {
      key: "admin-only",
      label: "Admin",
      roles: ["admin"],
      body: { kind: "custom", render: () => null },
    },
  ],
  ...over,
})

describe("visibleSections", () => {
  it("hides a section whose roles exclude the principal", () => {
    expect(visibleSections(stub(), "user").map((s) => s.key)).toEqual(["people", "types"])
  })

  it("shows it to the role that owns it", () => {
    expect(visibleSections(stub(), "admin").map((s) => s.key)).toContain("admin-only")
  })

  it("shows only unrestricted sections while the principal is still resolving", () => {
    // `role` is undefined for the render before /auth/me lands. Showing an
    // admin section optimistically and then yanking it is worse than a beat
    // of absence.
    expect(visibleSections(stub(), undefined).map((s) => s.key)).toEqual(["people", "types"])
  })
})

describe("resolveLocation", () => {
  it("falls back to the first domain for an unknown key", () => {
    const at = resolveLocation("no-such-domain", "people", "user")!
    expect(at.domain.key).toBe(visibleDomains("user")[0].key)
  })

  it("falls back to the first VISIBLE section for an unknown key", () => {
    const at = resolveLocation(visibleDomains("user")[0].key, "no-such-section", "user")!
    expect(at.section.key).toBe(visibleSections(at.domain, "user")[0].key)
  })

  it.each([null, undefined, 42, "", {}, []])("never throws on %p", (v) => {
    expect(() => resolveLocation(v, v, "user")).not.toThrow()
  })

  it("resolves an exact hit unchanged", () => {
    const d = visibleDomains("user")[0]
    const s = visibleSections(d, "user")[0]
    const at = resolveLocation(d.key, s.key, "user")!
    expect([at.domain.key, at.section.key]).toEqual([d.key, s.key])
  })
})

describe("the real registry", () => {
  it("exposes at least one domain to an ordinary user", () => {
    expect(visibleDomains("user").length).toBeGreaterThan(0)
  })

  it("gives every domain a unique key, and every section a unique key within it", () => {
    const domains = visibleDomains("admin")
    expect(new Set(domains.map((d) => d.key)).size).toBe(domains.length)
    for (const d of domains) {
      const keys = d.sections.map((s) => s.key)
      expect(new Set(keys).size, `duplicate section key in ${d.key}`).toBe(keys.length)
    }
  })

  it("gives every domain at least one section an ordinary user can see", () => {
    // A domain that renders an empty pane for most of its audience is a
    // navigation dead end; visibleDomains drops it, and this asserts we never
    // ship one by accident.
    for (const d of visibleDomains("user")) {
      expect(visibleSections(d, "user").length, `${d.key} has no user-visible section`).toBeGreaterThan(0)
    }
  })
})
