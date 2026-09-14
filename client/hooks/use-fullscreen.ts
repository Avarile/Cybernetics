"use client"

import { useCallback, useSyncExternalStore } from "react"

function subscribe(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange)
  return () => document.removeEventListener("fullscreenchange", onChange)
}

/**
 * Read from the document every time rather than kept as state of our own.
 *
 * Full screen is owned by the browser, not by us: Escape and F11 leave it
 * without going anywhere near the button, and `fullscreenchange` is the only
 * thing that hears about it. A boolean we set in the click handler would be
 * wrong the first time someone pressed Escape and stay wrong until they clicked
 * again.
 */
const getSnapshot = () => document.fullscreenElement != null

/** No document on the server, and nothing is full screen before hydration. */
const getServerSnapshot = () => false

export function useFullscreen() {
  const active = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Both calls reject rather than throw when the browser refuses — no user
  // gesture behind the call, or an iframe without `allowfullscreen`. Swallowed:
  // there is nothing useful to say, and the button not working is already the
  // whole of what the user sees.
  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
      return
    }
    document.documentElement.requestFullscreen().catch(() => {})
  }, [])

  return { active, toggle }
}
