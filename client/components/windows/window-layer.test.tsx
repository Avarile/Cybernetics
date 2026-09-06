import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useWindowStore } from "@/stores/window.store"
import { Dock } from "./dock"
import { WindowLayer } from "./window-layer"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

const s = () => useWindowStore.getState()

describe("WindowLayer", () => {
  beforeEach(() => {
    s().closeAll()
    s().setViewport({ w: 1400, h: 900 })
  })

  it("renders nothing when no windows are open", () => {
    render(<WindowLayer />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("renders two concurrent windows at once", async () => {
    s().openWindow({ kind: "terminal", title: "Terminal" })
    s().openWindow({ kind: "voice", title: "Live" })
    render(<WindowLayer />)
    expect(await screen.findByRole("dialog", { name: "Terminal" })).toBeInTheDocument()
    expect(await screen.findByRole("dialog", { name: "Live" })).toBeInTheDocument()
  })

  it("does not render a minimised window", () => {
    const id = s().openWindow({ kind: "terminal", title: "Terminal" })
    s().minimiseWindow(id)
    render(<WindowLayer />)
    expect(screen.queryByRole("dialog", { name: "Terminal" })).not.toBeInTheDocument()
  })

  it("closing a window removes it from the store", async () => {
    s().openWindow({ kind: "terminal", title: "Terminal" })
    render(<WindowLayer />)
    await userEvent.click(await screen.findByRole("button", { name: /close/i }))
    expect(s().windows).toHaveLength(0)
  })

  it("skips a kind that has no registry entry rather than crashing", () => {
    // `tags` is a valid WindowKind but is not registered until Phase 4.
    s().openWindow({ kind: "tags", title: "Tags" })
    render(<WindowLayer />)
    expect(screen.queryByRole("dialog", { name: "Tags" })).not.toBeInTheDocument()
  })
})

describe("Dock", () => {
  beforeEach(() => {
    s().closeAll()
    s().setViewport({ w: 1400, h: 900 })
  })

  it("is hidden when nothing is minimised", () => {
    render(<Dock />)
    expect(screen.queryByRole("toolbar", { name: /minimised/i })).not.toBeInTheDocument()
  })

  it("lists a minimised window and restores it on click", async () => {
    const id = s().openWindow({ kind: "terminal", title: "Terminal" })
    s().minimiseWindow(id)
    render(<Dock />)

    await userEvent.click(screen.getByRole("button", { name: /Terminal/ }))
    expect(s().windows[0].state).toBe("normal")
  })
})
