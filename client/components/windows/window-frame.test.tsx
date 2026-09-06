import { render, screen } from "@testing-library/react"
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
    onMinimise: vi.fn(),
    onToggleMaximise: vi.fn(),
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

  it("calls onMinimise from the minimise button", async () => {
    const h = setup()
    await userEvent.click(screen.getByRole("button", { name: /minimise/i }))
    expect(h.onMinimise).toHaveBeenCalledTimes(1)
  })

  it("calls onToggleMaximise from the maximise button", async () => {
    const h = setup()
    await userEvent.click(screen.getByRole("button", { name: /maximise/i }))
    expect(h.onToggleMaximise).toHaveBeenCalledTimes(1)
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

  it("a maximised window fills the viewport", () => {
    setup({ state: "maximised" })
    const frame = screen.getByRole("dialog", { name: "Terminal" })
    expect(frame).toHaveStyle({ left: "0px", top: "0px" })
  })

  it("renders resize grips on desktop", () => {
    setup()
    expect(screen.getByTestId("resize-se")).toBeInTheDocument()
  })

  it("renders no resize grips when maximised", () => {
    setup({ state: "maximised" })
    expect(screen.queryByTestId("resize-se")).not.toBeInTheDocument()
  })

  it("renders no resize grips on mobile", () => {
    mobile.value = true
    setup()
    expect(screen.queryByTestId("resize-se")).not.toBeInTheDocument()
  })
})
