import { beforeEach, describe, expect, it } from "vitest"
import {
  MODAL_Z_BASE,
  selectMinimised,
  selectOpenWindows,
  selectTopModal,
  serialiseForPersist,
  useWorkspaceStore,
} from "./workspace.store"
import { useViewportStore } from "./viewport.store"

const s = () => useWorkspaceStore.getState()

describe("workspace.store", () => {
  beforeEach(() => {
    localStorage.clear()
    s().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
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

describe("workspace.store persistence", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
  })

  it("persists non-modal windows under the new envelope", async () => {
    useWorkspaceStore.getState().openWindow({ kind: "contacts" })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(1)
    expect(stored.state.windows[0].kind).toBe("contacts")
  })

  it("never persists a modal window", async () => {
    // `terminal`, not `auth`: `auth` is already in NEVER_PERSIST, so opening it
    // would pass this test even if the `!w.modal &&` clause were deleted from
    // serialiseForPersist. `terminal` is a plain, persistable kind, so the only
    // thing keeping it out here is the ad-hoc `modal: true` on this call.
    useWorkspaceStore.getState().openWindow({ kind: "terminal", modal: true })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(0)
  })

  it("never persists a transient record window", async () => {
    useWorkspaceStore.getState().openWindow({ kind: "record-edit", singletonKey: "x" })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(0)
  })

  it("rehydrates a legacy cyb.windows payload and clears the legacy key", async () => {
    localStorage.setItem(
      "cyb.windows",
      JSON.stringify({
        version: 1,
        windows: [
          {
            id: "w1",
            kind: "contacts",
            title: "Contacts",
            rect: { x: 10, y: 10, w: 400, h: 300 },
            zIndex: 4,
            state: "normal",
            modal: false,
          },
        ],
      }),
    )

    // The legacy reader runs through the store's own storage adapter on the
    // first getItem, which rehydrate() triggers.
    await useWorkspaceStore.persist.rehydrate()

    expect(useWorkspaceStore.getState().windows).toHaveLength(1)
    expect(useWorkspaceStore.getState().zSeq).toBe(4)
    // The slot was rewritten as an envelope, so a second read takes the fast
    // path — and specifically still holds the restored window, not just any
    // envelope shape (an empty `{state:{windows:[]}}` would also pass a bare
    // `toHaveProperty("state.windows")` check).
    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(1)
  })

  it("re-validates an envelope on every rehydrate, not just the legacy upgrade", async () => {
    // A real persist envelope, so the legacy converter is never reached — this
    // is the path every load after the first one takes.
    localStorage.setItem(
      "cyb.windows",
      JSON.stringify({
        version: 1,
        state: {
          windows: [
            {
              id: "good",
              kind: "contacts",
              title: "Contacts",
              rect: { x: 10, y: 10, w: 400, h: 300 },
              zIndex: 4,
              state: "normal",
              modal: false,
            },
            {
              id: "bad",
              kind: "terminal",
              title: "Terminal",
              // 1e999 parses back as Infinity: typeof "number", and it would
              // poison zSeq for the whole session through nextZ.
              rect: { x: 0, y: 0, w: 900, h: 600 },
              zIndex: 1e999,
              state: "normal",
              modal: false,
            },
            { id: "junk", kind: "no-such-kind", title: "?", rect: {}, zIndex: 1, state: "normal", modal: false },
          ],
          zSeq: 1e999,
        },
      }),
    )

    await useWorkspaceStore.persist.rehydrate()

    expect(useWorkspaceStore.getState().windows.map((w) => w.id)).toEqual(["good"])
    // And zSeq comes from what survived, so the next window opens at 5 rather
    // than behind an unreachable z-index.
    expect(useWorkspaceStore.getState().zSeq).toBe(4)
  })

  it("leaves an already-open workspace alone when storage is empty", async () => {
    // `skipHydration` means windows can be opened before `rehydrate()` runs,
    // and zustand applies `merge`'s result with `set(state, true)` — a replace.
    // A merge that did not special-case empty storage would clear them.
    const id = useWorkspaceStore.getState().openWindow({ kind: "contacts" })
    localStorage.clear()

    await useWorkspaceStore.persist.rehydrate()

    expect(useWorkspaceStore.getState().windows.map((w) => w.id)).toEqual([id])
  })

  it("clamps against the viewport store rather than its own copy", () => {
    useViewportStore.getState().setViewport({ w: 500, h: 400 })
    const id = useWorkspaceStore.getState().openWindow({ kind: "contacts" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.rect.w).toBeLessThanOrEqual(500)
    expect(win.rect.h).toBeLessThanOrEqual(400)
  })
})

describe("openWindow resolves the registry descriptor", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1440, h: 900 })
  })

  it("uses the kind's declared defaultRect instead of the store default", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "confirm", singletonKey: "c:1" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect({ w: win.rect.w, h: win.rect.h }).toEqual({ w: 420, h: 220 })
  })

  it("falls back to the store default for a kind that declares no rect", () => {
    // `auth` is chromeless: WindowLayer centres it and never reads its rect, so
    // WINDOW_META deliberately gives it no defaultRect.
    const id = useWorkspaceStore.getState().openWindow({ kind: "auth" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect({ w: win.rect.w, h: win.rect.h }).toEqual({ w: 900, h: 600 })
  })

  it("marks a kind declared modal as modal without the caller saying so", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "auth" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.modal).toBe(true)
    expect(win.zIndex).toBeGreaterThanOrEqual(MODAL_Z_BASE)
  })

  it("carries the declared minSize onto the instance", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.minSize).toEqual({ w: 420, h: 320 })
  })

  it("takes the declared title when the caller gives none", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    expect(useWorkspaceStore.getState().windows.find((w) => w.id === id)!.title).toBe("Terminal")
  })

  it("lets an explicit override beat the descriptor", () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "terminal", title: "Shell", rect: { w: 500 } })
    const win = useWorkspaceStore.getState().windows.find((w) => w.id === id)!
    expect(win.title).toBe("Shell")
    expect(win.rect.w).toBe(500)
  })

  it("opens a second instance of a non-singleton kind", () => {
    const a = useWorkspaceStore.getState().openWindow({ kind: "record-edit", singletonKey: "e:1" })
    const b = useWorkspaceStore.getState().openWindow({ kind: "record-edit", singletonKey: "e:2" })
    expect(a).not.toBe(b)
    expect(useWorkspaceStore.getState().windows).toHaveLength(2)
  })

  it("focuses rather than duplicating a singleton kind", () => {
    const a = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    const b = useWorkspaceStore.getState().openWindow({ kind: "terminal" })
    expect(a).toBe(b)
    expect(useWorkspaceStore.getState().windows).toHaveLength(1)
  })
})
