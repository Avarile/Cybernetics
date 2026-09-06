"use client"

import { useEffect, useRef } from "react"
import { WINDOW_STORAGE_KEY, serialiseForPersist, useWindowStore } from "@/stores/window.store"
import { WINDOW_REGISTRY } from "@/lib/windows/registry"
import type { WindowInstance } from "@/lib/windows/types"

/** Bumped when the persisted shape changes, so old payloads are dropped rather
 *  than fed to a reader that no longer understands them. */
const SCHEMA_VERSION = 1

interface Persisted {
  version: number
  windows: WindowInstance[]
}

function isRect(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false
  const r = v as Record<string, unknown>
  return (["x", "y", "w", "h"] as const).every((k) => typeof r[k] === "number")
}

/**
 * Validates a stored instance before it reaches the store.
 *
 * localStorage is user-writable and survives deploys, so a payload here can be
 * stale or hand-edited. A window whose kind is no longer registered is dropped
 * rather than restored into a layer that would render nothing for it.
 */
function isRestorable(v: unknown): v is WindowInstance {
  if (typeof v !== "object" || v === null) return false
  const w = v as Record<string, unknown>
  return (
    typeof w.id === "string" &&
    typeof w.kind === "string" &&
    typeof w.title === "string" &&
    typeof w.zIndex === "number" &&
    (w.state === "normal" || w.state === "minimised" || w.state === "maximised") &&
    w.modal === false &&
    isRect(w.rect) &&
    Object.hasOwn(WINDOW_REGISTRY, w.kind as string)
  )
}

export function readPersistedWindows(raw: string | null): WindowInstance[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Persisted
    if (parsed?.version !== SCHEMA_VERSION || !Array.isArray(parsed.windows)) return []
    return parsed.windows.filter(isRestorable)
  } catch {
    return []
  }
}

export function serialisePersistedWindows(windows: WindowInstance[]): string {
  return JSON.stringify({
    version: SCHEMA_VERSION,
    windows: serialiseForPersist(windows),
  } satisfies Persisted)
}

/**
 * Restores the workspace on mount and keeps it written on every change.
 *
 * Only the layout is persisted — never in-flight work. `serialiseForPersist`
 * drops modals and `record-*` windows for that reason.
 */
export function useWindowPersistence(): void {
  const hydrated = useRef(false)

  useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true

    const restored = readPersistedWindows(localStorage.getItem(WINDOW_STORAGE_KEY))
    if (restored.length > 0) {
      useWindowStore.getState().hydrate(restored)
    }

    // Subscribed after hydration so the restore itself does not immediately
    // write back a half-applied state.
    return useWindowStore.subscribe((state) => {
      try {
        localStorage.setItem(WINDOW_STORAGE_KEY, serialisePersistedWindows(state.windows))
      } catch {
        // Quota or a privacy mode that refuses writes. Losing the layout is not
        // worth breaking the session over.
      }
    })
  }, [])
}
