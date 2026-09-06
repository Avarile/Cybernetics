import { beforeEach, describe, expect, it } from "vitest"
import {
  selectMinimised,
  selectOpenWindows,
  selectTopModal,
  serialiseForPersist,
  useWindowStore,
} from "./window.store"

const s = () => useWindowStore.getState()

describe("window.store", () => {
  beforeEach(() => {
    localStorage.clear()
    s().closeAll()
    s().setViewport({ w: 1400, h: 900 })
  })

  it("opens a window and returns its id", () => {
    const id = s().openWindow({ kind: "terminal" })
    expect(id).toBeTruthy()
    expect(s().windows).toHaveLength(1)
    expect(s().windows[0].kind).toBe("terminal")
  })

  it("focuses an existing singleton instead of duplicating it", () => {
    const first = s().openWindow({ kind: "terminal" })
    s().openWindow({ kind: "contacts" })
    const again = s().openWindow({ kind: "terminal" })

    expect(again).toBe(first)
    expect(s().windows).toHaveLength(2)
    const top = [...s().windows].sort((a, b) => b.zIndex - a.zIndex)[0]
    expect(top.id).toBe(first)
  })

  it("re-opening a minimised singleton restores it", () => {
    const id = s().openWindow({ kind: "terminal" })
    s().minimiseWindow(id)
    expect(s().windows[0].state).toBe("minimised")
    s().openWindow({ kind: "terminal" })
    expect(s().windows[0].state).toBe("normal")
  })

  it("keys non-singletons so the same record opens once but two records coexist", () => {
    const a1 = s().openWindow({ kind: "record-detail", singletonKey: "contacts:1", props: { id: "1" } })
    const a2 = s().openWindow({ kind: "record-detail", singletonKey: "contacts:1", props: { id: "1" } })
    const b = s().openWindow({ kind: "record-detail", singletonKey: "contacts:2", props: { id: "2" } })

    expect(a2).toBe(a1)
    expect(b).not.toBe(a1)
    expect(s().windows).toHaveLength(2)
  })

  it("keeps the terminal and the voice window open at the same time", () => {
    // The design's defining window requirement (§3, §7.2).
    s().openWindow({ kind: "terminal" })
    s().openWindow({ kind: "voice" })
    expect(selectOpenWindows(s()).map((w) => w.kind).sort()).toEqual(["terminal", "voice"])
  })

  it("assigns an increasing zIndex and focus raises to the top", () => {
    const a = s().openWindow({ kind: "terminal" })
    const b = s().openWindow({ kind: "contacts" })
    expect(s().windows.find((w) => w.id === b)!.zIndex).toBeGreaterThan(
      s().windows.find((w) => w.id === a)!.zIndex,
    )

    s().focusWindow(a)
    expect(s().windows.find((w) => w.id === a)!.zIndex).toBeGreaterThan(
      s().windows.find((w) => w.id === b)!.zIndex,
    )
  })

  it("keeps modal windows above every non-modal window", () => {
    s().openWindow({ kind: "terminal" })
    const auth = s().openWindow({ kind: "auth", modal: true })
    const late = s().openWindow({ kind: "contacts" })

    const modalZ = s().windows.find((w) => w.id === auth)!.zIndex
    const lateZ = s().windows.find((w) => w.id === late)!.zIndex
    expect(modalZ).toBeGreaterThan(lateZ)
    expect(selectTopModal(s())?.id).toBe(auth)
  })

  it("keeps a modal on top even after a non-modal is explicitly focused", () => {
    const auth = s().openWindow({ kind: "auth", modal: true })
    const term = s().openWindow({ kind: "terminal" })
    s().focusWindow(term)
    expect(s().windows.find((w) => w.id === auth)!.zIndex).toBeGreaterThan(
      s().windows.find((w) => w.id === term)!.zIndex,
    )
  })

  it("cascades so two windows do not sit exactly on top of each other", () => {
    s().openWindow({ kind: "terminal" })
    s().openWindow({ kind: "contacts" })
    const [a, b] = s().windows
    expect({ x: b.rect.x, y: b.rect.y }).not.toEqual({ x: a.rect.x, y: a.rect.y })
  })

  it("closes a window", () => {
    const id = s().openWindow({ kind: "terminal" })
    s().closeWindow(id)
    expect(s().windows).toHaveLength(0)
  })

  it("toggles maximise and back to normal", () => {
    const id = s().openWindow({ kind: "terminal" })
    s().toggleMaximise(id)
    expect(s().windows[0].state).toBe("maximised")
    s().toggleMaximise(id)
    expect(s().windows[0].state).toBe("normal")
  })

  it("moveWindow records a new rect", () => {
    const id = s().openWindow({ kind: "terminal" })
    s().moveWindow(id, { x: 10, y: 20, w: 400, h: 300 })
    expect(s().windows[0].rect).toEqual({ x: 10, y: 20, w: 400, h: 300 })
  })

  it("moveWindow clamps a rect dragged off-screen", () => {
    const id = s().openWindow({ kind: "terminal" })
    s().moveWindow(id, { x: 99_999, y: 99_999, w: 400, h: 300 })
    const r = s().windows[0].rect
    expect(r.x + r.w).toBeLessThanOrEqual(1400)
    expect(r.y + r.h).toBeLessThanOrEqual(900)
  })

  it("selectors split normal from minimised", () => {
    const a = s().openWindow({ kind: "terminal" })
    s().openWindow({ kind: "contacts" })
    s().minimiseWindow(a)

    expect(selectOpenWindows(s()).map((w) => w.kind)).toEqual(["contacts"])
    expect(selectMinimised(s()).map((w) => w.kind)).toEqual(["terminal"])
  })

  it("excludes modal and record-* windows from persistence", () => {
    s().openWindow({ kind: "terminal" })
    s().openWindow({ kind: "auth", modal: true })
    s().openWindow({ kind: "record-edit", singletonKey: "contacts:1" })

    const persisted = serialiseForPersist(s().windows)
    expect(persisted.map((w) => w.kind)).toEqual(["terminal"])
  })
})
