import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useFullscreen } from "./use-fullscreen"

// jsdom implements none of the Fullscreen API, so the element and both calls are
// stood up here. `fullscreenElement` is defined as a getter rather than assigned,
// which is what lets a test move it and have the hook's snapshot follow.
let element: Element | null = null
const request = vi.fn(() => Promise.resolve())
const exit = vi.fn(() => Promise.resolve())

Object.defineProperty(document, "fullscreenElement", { get: () => element })
Object.defineProperty(Element.prototype, "requestFullscreen", {
  value: request,
})
Object.defineProperty(document, "exitFullscreen", { value: exit })

/** What the browser does when full screen is entered or left. */
function enter(el: Element | null) {
  act(() => {
    element = el
    document.dispatchEvent(new Event("fullscreenchange"))
  })
}

afterEach(() => {
  element = null
  vi.clearAllMocks()
})

describe("useFullscreen", () => {
  it("starts inactive and asks for full screen on the first toggle", () => {
    const { result } = renderHook(() => useFullscreen())
    expect(result.current.active).toBe(false)

    act(() => result.current.toggle())
    expect(request).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it("exits when something is already full screen", () => {
    const { result } = renderHook(() => useFullscreen())
    enter(document.documentElement)

    act(() => result.current.toggle())
    expect(exit).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
  })

  // The reason this is useSyncExternalStore and not a boolean of our own: Escape
  // and F11 leave full screen without going through the button, and only the
  // event says so.
  it("tracks a change it did not initiate", () => {
    const { result } = renderHook(() => useFullscreen())

    enter(document.documentElement)
    expect(result.current.active).toBe(true)

    enter(null)
    expect(result.current.active).toBe(false)
  })

  it("swallows a rejected request rather than leaving it unhandled", async () => {
    request.mockImplementationOnce(() => Promise.reject(new Error("denied")))
    const { result } = renderHook(() => useFullscreen())

    act(() => result.current.toggle())
    await expect(Promise.resolve()).resolves.toBeUndefined()
    expect(result.current.active).toBe(false)
  })
})
