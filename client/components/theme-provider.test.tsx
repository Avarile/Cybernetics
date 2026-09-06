import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ThemeProvider } from "./theme-provider"

/**
 * jsdom reports an exception thrown inside a listener as an `error` event on
 * window rather than propagating it out of `dispatchEvent`, so a plain
 * `.not.toThrow()` would pass straight through the bug being guarded here.
 */
function captureErrors(): { errors: string[]; stop: () => void } {
  const errors: string[] = []
  const onError = (event: ErrorEvent) => {
    errors.push(event.error?.message ?? event.message)
    event.preventDefault()
  }
  window.addEventListener("error", onError)
  return { errors, stop: () => window.removeEventListener("error", onError) }
}

function renderThemed() {
  return render(
    <ThemeProvider>
      <input aria-label="note" />
    </ThemeProvider>,
  )
}

describe("ThemeProvider hotkey", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ""
  })

  afterEach(() => {
    document.documentElement.className = ""
  })

  it("survives a keydown that carries no key at all", () => {
    // Password managers and automation tooling dispatch bare `keydown` events
    // with no key data. A listener bound to window sees every one of them.
    const { errors, stop } = captureErrors()
    renderThemed()

    act(() => {
      window.dispatchEvent(new Event("keydown"))
    })
    stop()

    expect(errors).toEqual([])
  })

  it("survives a KeyboardEvent whose key is explicitly undefined", () => {
    const { errors, stop } = captureErrors()
    renderThemed()

    act(() => {
      const event = new KeyboardEvent("keydown")
      Object.defineProperty(event, "key", { value: undefined })
      window.dispatchEvent(event)
    })
    stop()

    expect(errors).toEqual([])
  })

  it("still toggles the theme on d", () => {
    renderThemed()

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "d" }))
    })

    expect(localStorage.getItem("theme")).toBe("dark")
  })

  it("leaves the theme alone while the user is typing", () => {
    const { getByLabelText } = renderThemed()
    const input = getByLabelText("note")

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }))
    })

    expect(localStorage.getItem("theme")).toBeNull()
  })
})
