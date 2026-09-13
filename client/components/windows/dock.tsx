"use client"

import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useWorkspace } from "@/features/workspace/use-workspace"
import { WINDOW_META } from "@/lib/windows/meta"
import type { WindowInstance } from "@/lib/windows/types"

/**
 * One dock entry, split out from Dock because `useWindowControls(win.id)`
 * cannot be called inside the `.map()` below — the list's length changes as
 * windows are minimised and restored, which would break the rules of hooks.
 *
 * Two controls, not one: minimising was a one-way door into the dock, where
 * the only way to be rid of a window was to restore it and then close it. The
 * label restores, the × disposes of it where it stands.
 */
function DockEntry({ win }: { win: WindowInstance }) {
  const { restore, focus, close } = useWindowControls(win.id)
  const Icon = WINDOW_META[win.kind]?.icon
  return (
    // A wrapper rather than a button containing a button: nesting them is
    // invalid HTML, and the inner click would reach the outer handler too.
    <div className="flex items-center rounded-md hover:bg-accent">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 pr-1 text-xs hover:bg-transparent"
        onClick={() => {
          restore()
          focus()
        }}
      >
        {Icon && <Icon className="size-3.5" />}
        {win.title}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Close ${win.title}`}
        onClick={close}
        className="mr-1 size-5 rounded-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
      >
        <XIcon className="size-3" />
      </Button>
    </div>
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
