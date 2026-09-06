"use client"

import { Button } from "@/components/ui/button"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useWorkspace } from "@/features/workspace/use-workspace"
import { WINDOW_META } from "@/lib/windows/meta"
import type { WindowInstance } from "@/lib/windows/types"

/**
 * One dock entry, split out from Dock because `useWindowControls(win.id)`
 * cannot be called inside the `.map()` below — the list's length changes as
 * windows are minimised and restored, which would break the rules of hooks.
 */
function DockEntry({ win }: { win: WindowInstance }) {
  const { restore, focus } = useWindowControls(win.id)
  const Icon = WINDOW_META[win.kind]?.icon
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={() => {
        restore()
        focus()
      }}
    >
      {Icon && <Icon className="size-3.5" />}
      {win.title}
    </Button>
  )
}

export function Dock() {
  const { minimised } = useWorkspace()

  if (minimised.length === 0) return null

  return (
    <div
      role="toolbar"
      aria-label="Minimised windows"
      className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-1 border-t border-border bg-background/80 px-3 py-1.5 backdrop-blur-xl"
    >
      {minimised.map((win) => (
        <DockEntry key={win.id} win={win} />
      ))}
      <span className="ml-auto text-xs text-muted-foreground">
        {minimised.length} minimised
      </span>
    </div>
  )
}
