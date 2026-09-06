import { describe, expect, it } from "vitest"
import { readLegacyRefresh, readLegacyWindows } from "./legacy-storage"

const always = () => true
const never = () => false

describe("readLegacyRefresh", () => {
  it("reads a bare token string", () => {
    expect(readLegacyRefresh("abc.def.ghi")).toEqual({ refreshToken: "abc.def.ghi" })
  })

  it("trims surrounding whitespace", () => {
    expect(readLegacyRefresh("  abc  ")).toEqual({ refreshToken: "abc" })
  })

  it("returns null for nothing stored", () => {
    expect(readLegacyRefresh(null)).toBeNull()
    expect(readLegacyRefresh("")).toBeNull()
    expect(readLegacyRefresh("   ")).toBeNull()
  })

  it("refuses a persist envelope, so a re-read cannot swallow one", () => {
    expect(readLegacyRefresh('{"state":{"refreshToken":"x"},"version":1}')).toBeNull()
  })
})

describe("readLegacyWindows", () => {
  const win = {
    id: "w1",
    kind: "contacts",
    title: "Contacts",
    rect: { x: 0, y: 0, w: 900, h: 600 },
    zIndex: 3,
    state: "normal",
    modal: false,
  }

  it("reads the versioned envelope and derives zSeq from the highest zIndex", () => {
    const raw = JSON.stringify({ version: 1, windows: [win, { ...win, id: "w2", zIndex: 9 }] })
    expect(readLegacyWindows(raw, always)).toEqual({
      windows: [win, { ...win, id: "w2", zIndex: 9 }],
      zSeq: 9,
    })
  })

  it("drops windows the validator rejects", () => {
    const raw = JSON.stringify({ version: 1, windows: [win] })
    expect(readLegacyWindows(raw, never)).toEqual({ windows: [], zSeq: 0 })
  })

  it("returns null for a version it does not understand", () => {
    expect(readLegacyWindows(JSON.stringify({ version: 2, windows: [win] }), always)).toBeNull()
  })

  it("returns null for malformed json rather than throwing", () => {
    expect(readLegacyWindows("{not json", always)).toBeNull()
  })

  it("returns null for nothing stored", () => {
    expect(readLegacyWindows(null, always)).toBeNull()
  })

  it("returns null when windows is not an array", () => {
    expect(readLegacyWindows(JSON.stringify({ version: 1, windows: "nope" }), always)).toBeNull()
  })
})
