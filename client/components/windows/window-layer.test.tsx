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

  it("paints the modal scrim above every non-modal window", async () => {
    // Regression: the scrim rendered first in DOM order with no zIndex, while
    // every window carries an explicit one — so windows painted over it and
    // nothing behind the auth dialog was actually dimmed. Caught in a browser.
    s().openWindow({ kind: "terminal", title: "Terminal" })
    s().openWindow({ kind: "auth", title: "Access", modal: true })
    const { container } = render(<WindowLayer />)

    const scrim = container.querySelector<HTMLElement>(".bg-black\\/50")
    expect(scrim).not.toBeNull()

    const scrimZ = Number(scrim!.style.zIndex)
    const terminalZ = s().windows.find((w) => w.kind === "terminal")!.zIndex
    const modalZ = s().windows.find((w) => w.modal)!.zIndex

    expect(scrimZ).toBeGreaterThan(terminalZ)
    expect(scrimZ).toBeLessThan(modalZ)
  })

  it("renders no scrim when nothing modal is open", () => {
    s().openWindow({ kind: "terminal", title: "Terminal" })
    const { container } = render(<WindowLayer />)
    expect(container.querySelector(".bg-black\\/50")).toBeNull()
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
