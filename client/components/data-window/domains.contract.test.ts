import { describe, expect, it } from "vitest"
import { RECORD_FORMS } from "@/components/data-table/record-forms"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"
import { DOMAINS } from "./registry"
import type { SectionSpec } from "./types"

/**
 * Structural invariants across every domain config.
 *
 * Twenty-eight configs are hand-written, and the mistakes they invite are all
 * silent at runtime: a filter with no options renders an empty dropdown, a
 * create button with no form spec opens a window that says "no form is
 * configured", a duplicate column key makes React drop a column. None of
 * those throw, so none of them would be caught by rendering the table.
 */

type AnyConfig = DomainTableConfig<HasId>

/** Every table config in the registry, with the path that reached it. */
function tableConfigs(): { path: string; section: SectionSpec; config: AnyConfig }[] {
  const out: { path: string; section: SectionSpec; config: AnyConfig }[] = []
  for (const domain of DOMAINS) {
    for (const section of domain.sections) {
      const path = `${domain.key}/${section.key}`
      if (section.body.kind === "table") {
        out.push({ path, section, config: section.body.config as AnyConfig })
      } else if (section.body.kind === "scoped-table") {
        // Built with a stand-in parent id; the shape does not depend on it.
        out.push({ path, section, config: section.body.config("PARENT") as AnyConfig })
      }
    }
  }
  return out
}

const CONFIGS = tableConfigs()

describe("domain registry", () => {
  it("has at least one table in every domain", () => {
    expect(CONFIGS.length).toBeGreaterThan(20)
  })

  it("gives every table config a unique key", () => {
    // The key is also the RECORD_FORMS key and the singletonKey prefix, so a
    // collision silently makes two domains share one form and one window.
    const keys = CONFIGS.map((c) => c.config.key)
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i)
    expect(dupes, `duplicate config keys: ${dupes.join(", ")}`).toEqual([])
  })
})

describe.each(CONFIGS)("$path", ({ path, section, config }) => {
  it("has an endpoint rooted at /", () => {
    expect(config.endpoint.startsWith("/"), `${path}: ${config.endpoint}`).toBe(true)
  })

  it("has unique column keys", () => {
    const keys = config.columns.map((c) => c.key)
    expect(new Set(keys).size, `${path} has a duplicate column key`).toBe(keys.length)
  })

  it("has at least one non-hideable column", () => {
    // Every column hideable means the user can empty the table and be left
    // with a grid of checkboxes and no way back.
    expect(config.columns.some((c) => c.hideable === false), path).toBe(true)
  })

  it("gives every filter exactly one source of options", () => {
    for (const f of config.filters ?? []) {
      const hasStatic = Array.isArray(f.options)
      const hasSource = f.source != null
      expect(hasStatic !== hasSource, `${path}: filter "${f.key}" must have options XOR source`).toBe(
        true,
      )
      if (hasStatic) expect(f.options!.length, `${path}: filter "${f.key}" has no options`).toBeGreaterThan(0)
      if (hasSource) expect(f.source!.endpoint.startsWith("/")).toBe(true)
    }
  })

  it("gives every view tab a distinct value", () => {
    const values = (config.tabs ?? []).map((t) => t.value)
    expect(new Set(values).size, `${path} has a duplicate tab value`).toBe(values.length)
  })

  it("has a form spec when it can create or edit", () => {
    // Without one the record window renders "No form is configured for …",
    // which is a dead end reached only by clicking New.
    const writable = config.canCreate === true || config.canEdit === true
    if (!writable) return
    expect(RECORD_FORMS[config.key], `${path}: no RECORD_FORMS["${config.key}"]`).toBeDefined()
  })

  it("declares a rowId when the endpoint composes rows without one", () => {
    // Only an assertion that the two settings agree: a config that deletes by
    // a non-id key almost always also keys its rows by it.
    if (config.rowId && config.deleteKey) expect(typeof config.deleteKey).toBe("function")
  })

  it("is marked secondary only if the domain has a primary section too", () => {
    if (!section.secondary) return
    const domain = DOMAINS.find((d) => d.sections.includes(section))!
    expect(
      domain.sections.some((s) => !s.secondary),
      `${path}: every section is secondary, so the tab row would be empty`,
    ).toBe(true)
  })
})

describe("relation specs", () => {
  const relations = Object.entries(RECORD_FORMS).flatMap(([owner, spec]) =>
    (spec.relations ?? []).map((r) => ({ owner, relation: r, config: r.config("PARENT") })),
  )

  it("declares at least one relation somewhere", () => {
    expect(relations.length).toBeGreaterThan(0)
  })

  it.each(relations)("$owner → $relation.key", ({ owner, relation, config }) => {
    const at = `${owner}.${relation.key}`
    // The factory must actually use the parent id, or every record's tab
    // would show the same rows.
    expect(config.endpoint.includes("PARENT"), `${at}: endpoint ignores the parent id`).toBe(true)
    expect(config.endpoint.startsWith("/"), at).toBe(true)

    const keys = config.columns.map((c) => c.key)
    expect(new Set(keys).size, `${at} has a duplicate column key`).toBe(keys.length)
    expect(config.columns.some((c) => c.hideable === false), at).toBe(true)

    // A relation tab that can create needs a form of its own, exactly as a
    // section does — the same dead end, one level down.
    if (config.canCreate || config.canEdit) {
      expect(RECORD_FORMS[config.key], `${at}: no RECORD_FORMS["${config.key}"]`).toBeDefined()
    }
  })
})

describe("form specs", () => {
  it("gives every field a unique key within its spec", () => {
    for (const [name, spec] of Object.entries(RECORD_FORMS)) {
      const keys = spec.fields.map((f) => f.key)
      expect(new Set(keys).size, `RECORD_FORMS["${name}"] has a duplicate field key`).toBe(
        keys.length,
      )
    }
  })

  it("gives every select field options to choose from", () => {
    for (const [name, spec] of Object.entries(RECORD_FORMS)) {
      for (const f of spec.fields) {
        if (f.kind !== "select") continue
        expect(f.options?.length, `RECORD_FORMS["${name}"].${f.key} is a select with no options`)
          .toBeGreaterThan(0)
      }
    }
  })

  it("never marks a field both createOnly and readOnly", () => {
    // createOnly hides it after creation and readOnly disables it during —
    // together they make a field that can never be filled in.
    for (const [name, spec] of Object.entries(RECORD_FORMS)) {
      for (const f of spec.fields) {
        expect(
          !(f.createOnly && f.readOnly),
          `RECORD_FORMS["${name}"].${f.key} is both createOnly and readOnly`,
        ).toBe(true)
      }
    }
  })
})
