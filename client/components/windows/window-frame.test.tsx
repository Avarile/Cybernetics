import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { WindowInstance } from "@/lib/windows/types"
import { WindowFrame } from "./window-frame"

// vi.mock is hoisted above every const/let, so the factory cannot close over a
// normal variable — it would throw a ReferenceError at import time. vi.hoisted
// creates the holder in the same hoisted scope.
const mobile = vi.hoisted(() => ({ value: false }))
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => mobile.value }))

const WIN: WindowInstance = {
  id: "w1",
  kind: "terminal",
  title: "Terminal",
  rect: { x: 40, y: 40, w: 600, h: 400 },
  zIndex: 3,
  state: "normal",
  modal: false,
}

function setup(overrides: Partial<WindowInstance> = {}) {
  const handlers = {
    onClose: vi.fn(),
    onFocus: vi.fn(),
    onMove: vi.fn(),
  }
  render(
    <WindowFrame window={{ ...WIN, ...overrides }} {...handlers}>
      <p>window body</p>
    </WindowFrame>,
  )
  return handlers
}

describe("WindowFrame", () => {
  beforeEach(() => {
    mobile.value = false
  })

  it("renders the title and the children", () => {
    setup()
    expect(screen.getByText("Terminal")).toBeInTheDocument()
    expect(screen.getByText("window body")).toBeInTheDocument()
  })

  it("positions the frame from the rect and zIndex", () => {
    setup()
    const frame = screen.getByRole("dialog", { name: "Terminal" })
    expect(frame).toHaveStyle({
      left: "40px",
      top: "40px",
      width: "600px",
      height: "400px",
      zIndex: "3",
    })
  })

  it("calls onClose from the close button", async () => {
    const h = setup()
    await userEvent.click(screen.getByRole("button", { name: /close/i }))
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it("offers no minimise or maximise control", () => {
    setup()
    expect(screen.queryByRole("button", { name: /minimise/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /maximise/i })).not.toBeInTheDocument()
  })

  it("a pointer-down on the close button starts no drag", () => {
    // The jsdom-reachable proxy for the bug that made Close inert in a browser.
    // The close button sits inside the title bar, which is the drag handle; the
    // handle used to take pointer capture on any pointer-down that reached it,
    // and capture retargets the later `click` to the capturing element, so the
    // button's own onClick was never called. jsdom implements neither capture
    // nor click retargeting, so the click test above passed throughout.
    //
    // What IS observable here is the other half of the same handler: a gesture
    // that begins and ends without moving used to commit its rect anyway. If
    // `begin` bails on an interactive target, no gesture starts and onMove
    // stays untouched.
    const h = setup()
    const close = screen.getByRole("button", { name: /close/i })

    fireEvent.pointerDown(close, { button: 0, clientX: 50, clientY: 50 })
    fireEvent.pointerUp(window, { clientX: 50, clientY: 50 })

    expect(h.onMove).not.toHaveBeenCalled()
  })

  it("never takes pointer capture from a control in the title bar", () => {
    // The mechanism itself, pinned. jsdom implements neither setPointerCapture
    // nor the click retargeting it causes, so this has to be installed by hand
    // — which is exactly why the original click-the-button tests passed while
    // the button was dead in every real browser: the handle captured the
    // pointer, `pointerup` retargeted to the handle, and the browser dispatched
    // `click` at the handle rather than at the button.
    const capture = vi.fn()
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>
    const had = "setPointerCapture" in proto
    const previous = proto.setPointerCapture
    proto.setPointerCapture = capture
    proto.releasePointerCapture ??= () => {}

    try {
      setup()

      fireEvent.pointerDown(screen.getByRole("button", { name: /close/i }), {
        button: 0,
        clientX: 10,
        clientY: 10,
      })
      expect(capture).not.toHaveBeenCalled()

      // The same handle still captures for a real drag, which is what makes
      // the pointer follow the window outside its own bounds.
      fireEvent.pointerDown(screen.getByText("Terminal").parentElement!, {
        button: 0,
        clientX: 10,
        clientY: 10,
      })
      expect(capture).toHaveBeenCalled()
    } finally {
      if (had) proto.setPointerCapture = previous
      else delete proto.setPointerCapture
    }
  })

  it("a drag on the title bar still commits a moved rect", () => {
    // Guards the bail-out above from swallowing the gesture it exists beside.
    const h = setup()
    const bar = screen.getByText("Terminal").parentElement!

    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 })
    fireEvent.pointerUp(window, { clientX: 140, clientY: 130 })

    expect(h.onMove).toHaveBeenCalledWith({ x: 80, y: 70, w: 600, h: 400 })
  })

  it("a title-bar click that never moves commits nothing", () => {
    const h = setup()
    const bar = screen.getByText("Terminal").parentElement!

    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100 })
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 })

    expect(h.onMove).not.toHaveBeenCalled()
  })

  it("a title-bar pointer-down still raises the window", () => {
    // The drag handler used to stopPropagation, so dragging a background window
    // by its title bar never brought it forward.
    const h = setup()
    const bar = screen.getByText("Terminal").parentElement!

    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100 })

    expect(h.onFocus).toHaveBeenCalled()
  })

  it("focuses on pointer-down anywhere in the frame", async () => {
    const h = setup()
    await userEvent.click(screen.getByText("window body"))
    expect(h.onFocus).toHaveBeenCalled()
  })

  it("Escape closes a non-modal window", async () => {
    const h = setup()
    await userEvent.keyboard("{Escape}")
    expect(h.onClose).toHaveBeenCalledTimes(1)
  })

  it("Escape does NOT close a modal window", async () => {
    const h = setup({ modal: true })
    await userEvent.keyboard("{Escape}")
    expect(h.onClose).not.toHaveBeenCalled()
  })

  it("renders resize grips on desktop", () => {
    setup()
    expect(screen.getByTestId("resize-se")).toBeInTheDocument()
  })

  it("renders no resize grips on mobile", () => {
    mobile.value = true
    setup()
    expect(screen.queryByTestId("resize-se")).not.toBeInTheDocument()
  })
})
