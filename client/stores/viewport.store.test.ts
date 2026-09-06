import { beforeEach, describe, expect, it } from "vitest"
import { useViewportStore } from "./viewport.store"

const s = () => useViewportStore.getState()

describe("viewport.store", () => {
  beforeEach(() => s().setViewport({ w: 1440, h: 900 }))

  it("starts at a usable default so SSR never yields a zero viewport", () => {
    expect(s().w).toBeGreaterThan(0)
    expect(s().h).toBeGreaterThan(0)
  })

  it("records a measured viewport", () => {
    s().setViewport({ w: 800, h: 600 })
    expect({ w: s().w, h: s().h }).toEqual({ w: 800, h: 600 })
  })

  it("writes nothing to localStorage", () => {
    localStorage.clear()
    s().setViewport({ w: 640, h: 480 })
    expect(localStorage.length).toBe(0)
  })
})
