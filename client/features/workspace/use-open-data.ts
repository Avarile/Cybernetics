"use client"

import { useCallback } from "react"
import { useWorkspaceStore } from "@/stores/workspace.store"
import type { DomainKey } from "@/components/data-window/types"
import { useWorkspace } from "./use-workspace"

/**
 * Open the Data window at a given domain and section.
 *
 * Two calls, not one, and the second is the point: `data` is a singleton, so a
 * second `openWindow` focuses the existing instance and *discards* the props it
 * was passed. Without the patch, "show me this contact's domain" would focus a
 * window still sitting on whatever the user last looked at.
 *
 * This is the entry point for anything that navigates someone to data it does
 * not own — a notification, an agent turn, a future search result.
 */
export function useOpenData() {
  const { openWindow } = useWorkspace()
  const patchWindowProps = useWorkspaceStore((s) => s.patchWindowProps)

  return useCallback(
    (domain: DomainKey, section?: string) => {
      const props = { domain, ...(section ? { section } : {}) }
      const id = openWindow({ kind: "data", props })
      patchWindowProps(id, props)
      return id
    },
    [openWindow, patchWindowProps],
  )
}
