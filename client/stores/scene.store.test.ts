import { beforeEach, describe, expect, it } from "vitest"
import { useSceneStore } from "./scene.store"

const s = () => useSceneStore.getState()

describe("scene.store", () => {
  beforeEach(() => s().reset())

  it("starts with the panel and scanner on, matching the reference defaults", () => {
    expect(s().panelOpen).toBe(true)
    expect(s().scannerVisible).toBe(true)
  })

  it("toggles the panel", () => {
    s().togglePanel()
    expect(s().panelOpen).toBe(false)
  })

  it("toggles the scanner", () => {
    s().toggleScanner()
    expect(s().scannerVisible).toBe(false)
  })

  it("bumps a token to request a view reset", () => {
    const before = s().resetToken
    s().resetView()
    expect(s().resetToken).toBe(before + 1)
  })

  it("returns to defaults on reset", () => {
    s().togglePanel()
    s().resetView()
    s().reset()
    expect({ panelOpen: s().panelOpen, resetToken: s().resetToken }).toEqual({ panelOpen: true, resetToken: 0 })
  })

  it("writes nothing to localStorage", () => {
    localStorage.clear()
    s().togglePanel()
    expect(localStorage.length).toBe(0)
  })
})
