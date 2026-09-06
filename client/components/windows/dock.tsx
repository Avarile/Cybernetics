"use client"

import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { WINDOW_REGISTRY } from "@/lib/windows/registry"
import { selectMinimised, useWindowStore } from "@/stores/window.store"

export function Dock() {
  // See WindowLayer — selectMinimised also returns a fresh array each call.
  const minimised = useWindowStore(useShallow(selectMinimised))
  const restoreWindow = useWindowStore((st) => st.restoreWindow)
  const focusWindow = useWindowStore((st) => st.focusWindow)

  if (minimised.length === 0) return null

  return (
    <div
      role="toolbar"
      aria-label="Minimised windows"
      className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-1 border-t border-border bg-background/80 px-3 py-1.5 backdrop-blur-xl"
    >
      {minimised.map((win) => {
        const Icon = WINDOW_REGISTRY[win.kind]?.icon
        return (
          <Button
            key={win.id}
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => {
              restoreWindow(win.id)
              focusWindow(win.id)
            }}
          >
            {Icon && <Icon className="size-3.5" />}
            {win.title}
          </Button>
        )
      })}
      <span className="ml-auto text-xs text-muted-foreground">
        {minimised.length} minimised
      </span>
    </div>
  )
}
