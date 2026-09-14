import { beforeEach, describe, expect, it } from "vitest"
import {
  MODAL_Z_BASE,
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
    s().openWindow({ kind: "data" })
    const again = s().openWindow({ kind: "terminal" })

    expect(again).toBe(first)
    expect(s().windows).toHaveLength(2)
    const top = [...s().windows].sort((a, b) => b.zIndex - a.zIndex)[0]
    expect(top.id).toBe(first)
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
    const b = s().openWindow({ kind: "data" })
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
    const late = s().openWindow({ kind: "data" })

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

  it("cascades so two windows of a cascading kind do not sit exactly on top of each other", () => {
    // Record kinds, not terminal/data: those two declare `placement: "centre"`
    // and are singletons, so they can never stack in the first place.
    s().openWindow({ kind: "record-edit", singletonKey: "e:1" })
    s().openWindow({ kind: "record-edit", singletonKey: "e:2" })
    const [a, b] = s().windows
    expect({ x: b.rect.x, y: b.rect.y }).not.toEqual({ x: a.rect.x, y: a.rect.y })
  })

  it("centres the kinds that declare it, and only those", () => {
    // 1400x900 viewport, from beforeEach.
    const term = s().openWindow({ kind: "terminal" })
    const rec = s().openWindow({ kind: "record-edit", singletonKey: "e:1" })

    const t = s().windows.find((w) => w.id === term)!.rect
    expect(t.x).toBe(Math.round((1400 - t.w) / 2))
    expect(t.y).toBe(Math.round((900 - t.h) / 2))

    // A cascading kind still starts from the corner default.
    const r = s().windows.find((w) => w.id === rec)!.rect
    expect(r.x).not.toBe(Math.round((1400 - r.w) / 2))
  })

  it("centres the modal confirm rather than cascading it into the corner", () => {
    const id = s().openWindow({ kind: "confirm", singletonKey: "c:1" })
    const r = s().windows.find((w) => w.id === id)!.rect
    expect({ x: r.x, y: r.y }).toEqual({
      x: Math.round((1400 - r.w) / 2),
      y: Math.round((900 - r.h) / 2),
    })
  })

  it("lets an explicit rect.x beat the declared centring", () => {
    const id = s().openWindow({ kind: "terminal", rect: { x: 7, y: 9 } })
    const r = s().windows.find((w) => w.id === id)!.rect
    expect({ x: r.x, y: r.y }).toEqual({ x: 7, y: 9 })
  })

  it("closes a window", () => {
    const id = s().openWindow({ kind: "terminal" })
    s().closeWindow(id)
    expect(s().windows).toHaveLength(0)
  })

  it("focusWindow is a no-op when the window is already on top", () => {
    // Every WindowFrame calls focus from onPointerDown, so this fires on every
    // click anywhere inside a window. Without the guard each one bumped zSeq,
    // wrote the whole workspace to localStorage and re-rendered every
    // subscriber — and zSeq climbed without bound across a session.
    s().openWindow({ kind: "terminal" })
    const top = s().openWindow({ kind: "data" })
    const seq = s().zSeq
    const z = s().windows.find((w) => w.id === top)!.zIndex

    s().focusWindow(top)
    s().focusWindow(top)

    expect(s().zSeq).toBe(seq)
    expect(s().windows.find((w) => w.id === top)!.zIndex).toBe(z)
  })

  it("focusWindow still raises a window that is not on top", () => {
    const under = s().openWindow({ kind: "terminal" })
    const over = s().openWindow({ kind: "data" })

    s().focusWindow(under)

    expect(s().windows.find((w) => w.id === under)!.zIndex).toBeGreaterThan(
      s().windows.find((w) => w.id === over)!.zIndex,
    )
  })

  it("focusWindow compares within a band, so a non-modal under a modal settles", () => {
    // The top-most window overall is the modal. A non-modal that compared
    // against it could never reach the top and would rewrite its zIndex on
    // every single click — the exact churn the guard exists to stop.
    s().openWindow({ kind: "auth", modal: true })
    const term = s().openWindow({ kind: "terminal" })
    s().focusWindow(term)
    const seq = s().zSeq

    s().focusWindow(term)

    expect(s().zSeq).toBe(seq)
  })

  it("moveWindow is a no-op when the rect is unchanged", () => {
    const id = s().openWindow({ kind: "terminal" })
    const before = s().windows[0]
    s().moveWindow(id, { ...before.rect })
    // Same object identity: immer produced no new draft, so persist wrote
    // nothing and no subscriber re-rendered.
    expect(s().windows[0]).toBe(before)
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

  it("selectOpenWindows sorts by z-index without mutating the store array", () => {
    const a = s().openWindow({ kind: "terminal" })
    s().openWindow({ kind: "data" })
    s().focusWindow(a)

    expect(selectOpenWindows(s()).map((w) => w.kind)).toEqual(["data", "terminal"])
    // The store's own array keeps insertion order — the selector copies first.
    expect(s().windows.map((w) => w.kind)).toEqual(["terminal", "data"])
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
    useWorkspaceStore.getState().openWindow({ kind: "data" })
    await Promise.resolve()

    const stored = JSON.parse(localStorage.getItem("cyb.windows")!)
    expect(stored.state.windows).toHaveLength(1)
    expect(stored.state.windows[0].kind).toBe("data")
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
            kind: "data",
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
              kind: "data",
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

  it("normalises a window persisted as minimised by an older build", async () => {
    // Minimise is gone and so is the dock. Restoring one in that state would
    // put a window on screen that nothing can render and nothing can recover.
    localStorage.setItem(
      "cyb.windows",
      JSON.stringify({
        version: 1,
        state: {
          windows: [
            {
              id: "w1",
              kind: "data",
              title: "Data",
              rect: { x: 10, y: 10, w: 400, h: 300 },
              zIndex: 4,
              state: "minimised",
              modal: false,
            },
          ],
          zSeq: 4,
        },
      }),
    )

    await useWorkspaceStore.persist.rehydrate()

    expect(useWorkspaceStore.getState().windows.map((w) => w.state)).toEqual(["normal"])
  })

  it("re-clamps a restored rect against the current viewport", async () => {
    // A layout saved on a wide monitor, reopened on a laptop. Nothing re-clamps
    // after rehydrate, so an oversized rect stayed half off-screen until the
    // user dragged it.
    useViewportStore.getState().setViewport({ w: 800, h: 600 })
    localStorage.setItem(
      "cyb.windows",
      JSON.stringify({
        version: 1,
        state: {
          windows: [
            {
              id: "w1",
              kind: "data",
              title: "Data",
              rect: { x: 1200, y: 900, w: 1600, h: 1000 },
              zIndex: 4,
              state: "normal",
              modal: false,
            },
          ],
          zSeq: 4,
        },
      }),
    )

    await useWorkspaceStore.persist.rehydrate()

    const r = useWorkspaceStore.getState().windows[0].rect
    expect(r.x + r.w).toBeLessThanOrEqual(800)
    expect(r.y + r.h).toBeLessThanOrEqual(600)
  })

  it("re-centres a restored window whose kind declares placement: centre", async () => {
    // `placement: "centre"` has to mean every open, not just the first. The
    // rect persists, so without this a window dragged into a corner came back
    // in that corner forever.
    useViewportStore.getState().setViewport({ w: 1440, h: 900 })
    localStorage.setItem(
      "cyb.windows",
      JSON.stringify({
        version: 1,
        state: {
          windows: [
            {
              id: "w1",
              kind: "data",
              title: "Data",
              rect: { x: 0, y: 0, w: 1000, h: 700 },
              zIndex: 1,
              state: "normal",
              modal: false,
            },
          ],
          zSeq: 1,
        },
      }),
    )

    await useWorkspaceStore.persist.rehydrate()

    const r = useWorkspaceStore.getState().windows[0].rect
    // Size is the user's; only the position is reclaimed.
    expect({ w: r.w, h: r.h }).toEqual({ w: 1000, h: 700 })
    expect(r.x).toBe(Math.round((1440 - 1000) / 2))
    expect(r.y).toBe(Math.round((900 - 700) / 2))
  })

  it("leaves a cascading kind's restored position alone", async () => {
    // The mirror of the test above: only centred kinds get repositioned.
    useViewportStore.getState().setViewport({ w: 1440, h: 900 })
    localStorage.setItem(
      "cyb.windows",
      JSON.stringify({
        version: 1,
        state: {
          windows: [
            {
              id: "w1",
              kind: "voice",
              title: "Live",
              rect: { x: 40, y: 60, w: 420, h: 480 },
              zIndex: 1,
              state: "normal",
              modal: false,
            },
          ],
          zSeq: 1,
        },
      }),
    )

    await useWorkspaceStore.persist.rehydrate()

    expect(useWorkspaceStore.getState().windows[0].rect).toEqual({
      x: 40,
      y: 60,
      w: 420,
      h: 480,
    })
  })

  it("leaves an already-open workspace alone when storage is empty", async () => {
    // `skipHydration` means windows can be opened before `rehydrate()` runs,
    // and zustand applies `merge`'s result with `set(state, true)` — a replace.
    // A merge that did not special-case empty storage would clear them.
    const id = useWorkspaceStore.getState().openWindow({ kind: "data" })
    localStorage.clear()

    await useWorkspaceStore.persist.rehydrate()

    expect(useWorkspaceStore.getState().windows.map((w) => w.id)).toEqual([id])
  })

  it("clamps against the viewport store rather than its own copy", () => {
    useViewportStore.getState().setViewport({ w: 500, h: 400 })
    const id = useWorkspaceStore.getState().openWindow({ kind: "data" })
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

describe("patchWindowProps", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1440, h: 900 })
  })

  const win = (id: string) => useWorkspaceStore.getState().windows.find((w) => w.id === id)!

  it("merges into existing props and leaves untouched keys alone", () => {
    const id = useWorkspaceStore.getState().openWindow({
      kind: "data",
      props: { domain: "contacts", section: "people" },
    })

    useWorkspaceStore.getState().patchWindowProps(id, { section: "companies" })

    expect(win(id).props).toMatchObject({ domain: "contacts", section: "companies" })
  })

  it("preserves __key even when the patch tries to overwrite it", () => {
    // __key is the de-duplication identity. Losing it would orphan the window
    // from its own singleton slot and the next openWindow would spawn a second.
    const id = useWorkspaceStore.getState().openWindow({ kind: "data" })
    const key = win(id).props?.__key

    useWorkspaceStore.getState().patchWindowProps(id, { __key: "hijacked", domain: "finance" })

    expect(win(id).props?.__key).toBe(key)
    expect(useWorkspaceStore.getState().openWindow({ kind: "data" })).toBe(id)
  })

  it("does not change zIndex or zSeq", () => {
    // Navigation, not focus: a section tab must never raise the window.
    const id = useWorkspaceStore.getState().openWindow({ kind: "data" })
    const z = win(id).zIndex
    const seq = useWorkspaceStore.getState().zSeq

    useWorkspaceStore.getState().patchWindowProps(id, { section: "companies" })

    expect(win(id).zIndex).toBe(z)
    expect(useWorkspaceStore.getState().zSeq).toBe(seq)
  })

  it("is a no-op for an unknown id", () => {
    useWorkspaceStore.getState().openWindow({ kind: "data" })
    expect(() => useWorkspaceStore.getState().patchWindowProps("nope", { a: 1 })).not.toThrow()
    expect(useWorkspaceStore.getState().windows).toHaveLength(1)
  })

  it("survives a persist round-trip", async () => {
    const id = useWorkspaceStore.getState().openWindow({ kind: "data" })
    useWorkspaceStore.getState().patchWindowProps(id, { domain: "finance", section: "invoices" })

    await useWorkspaceStore.persist.rehydrate()

    const restored = useWorkspaceStore.getState().windows[0]
    expect(restored.props).toMatchObject({ domain: "finance", section: "invoices" })
  })
})
