import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useViewportStore } from "@/stores/viewport.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useHasOpenWindows, useViewportSync, useWorkspace } from "./use-workspace"

const s = () => useWorkspaceStore.getState()

describe("useWorkspace", () => {
  beforeEach(() => {
    s().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
  })

  it("returns open windows sorted by z-index", () => {
    const a = s().openWindow({ kind: "terminal" })
    const b = s().openWindow({ kind: "data" })
    const c = s().openWindow({ kind: "voice" })
    // Focusing b after c raises its zIndex above c's, so a sort-by-insertion
    // (rather than by zIndex) would report the two in the wrong order.
    s().focusWindow(b)

    const { result } = renderHook(() => useWorkspace())

    expect(result.current.windows.map((w) => w.id)).toEqual([a, c, b])
  })

  it("returns a stable array identity when nothing changed", () => {
    s().openWindow({ kind: "terminal" })
    const { result, rerender } = renderHook(() => useWorkspace())
    const first = result.current.windows

    rerender()

    expect(result.current.windows).toBe(first)
  })
})

describe("useHasOpenWindows", () => {
  beforeEach(() => {
    s().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
  })

  it("reports whether anything is open", () => {
    const { result } = renderHook(() => useHasOpenWindows())
    expect(result.current).toBe(false)

    let id = ""
    act(() => {
      id = s().openWindow({ kind: "terminal" })
    })
    expect(result.current).toBe(true)

    act(() => s().closeWindow(id))
    expect(result.current).toBe(false)
  })

  it("does not re-render while a window is moved or focused", () => {
    // The whole point of the hook. `useWorkspace().windows` allocates a sorted
    // array per call, so the 3D canvas subscribed to it re-rendered on every
    // frame of a drag. A boolean compares equal and must not.
    const a = s().openWindow({ kind: "terminal" })
    const b = s().openWindow({ kind: "data" })

    let renders = 0
    renderHook(() => {
      renders++
      return useHasOpenWindows()
    })
    const baseline = renders

    act(() => s().moveWindow(a, { x: 10, y: 20, w: 600, h: 400 }))
    act(() => s().focusWindow(a))
    act(() => s().patchWindowProps(b, { section: "types" }))

    expect(renders).toBe(baseline)
  })
})

describe("useViewportSync", () => {
  let frames: FrameRequestCallback[]

  beforeEach(() => {
    frames = []
    vi.stubGlobal(
      "requestAnimationFrame",
      ((cb: FrameRequestCallback) => {
        frames.push(cb)
        return frames.length
      }) as typeof requestAnimationFrame,
    )
    vi.stubGlobal("cancelAnimationFrame", (() => {}) as typeof cancelAnimationFrame)
  })

  // Runs whatever frame(s) are currently pending, inside `act` since they
  // call into the store.
  function flushFrames() {
    const pending = frames
    frames = []
    act(() => pending.forEach((cb) => cb(0)))
  }

  it("coalesces a burst of resize events into a single viewport write", () => {
    // Not a spy on the store action: immer auto-freezes each produced state
    // object, and `vi.spyOn` on a frozen object throws "Cannot redefine
    // property" when vitest tries to restore it afterwards. A sentinel value
    // proves the same thing without touching the store's own properties.
    renderHook(() => useViewportSync())

    // Mounting itself calls sync() once; drain that frame so the burst below
    // is measured in isolation.
    flushFrames()

    act(() => {
      for (let i = 0; i < 20; i++) window.dispatchEvent(new Event("resize"))
    })

    // Twenty synchronous events must have coalesced into a single pending
    // frame — one eventual write, not twenty.
    expect(frames).toHaveLength(1)

    // Only the flushed frame's write can clear this sentinel.
    useViewportStore.setState({ w: -1 })
    expect(useViewportStore.getState().w).toBe(-1)

    flushFrames()

    expect(useViewportStore.getState().w).toBe(window.innerWidth)
  })
})
