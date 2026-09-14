"use client"

import { useEffect, type ReactNode } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import type { Rect, WindowInstance } from "@/lib/windows/types"
import { useDragResize, type ResizeHandle } from "./use-drag-resize"

export interface WindowFrameProps {
  window: WindowInstance
  onClose: () => void
  onFocus: () => void
  onMove: (rect: Rect) => void
  /**
   * Whether this frame owns the Escape key.
   *
   * Every frame used to register its own `document` keydown listener that
   * closed itself, so one Escape closed every non-modal window at once. Only
   * the top-most non-modal window should answer.
   */
  escapeCloses?: boolean
  children: ReactNode
}

const GRIPS: { handle: ResizeHandle; className: string }[] = [
  { handle: "n", className: "top-0 inset-x-3 h-1.5 cursor-ns-resize" },
  { handle: "s", className: "bottom-0 inset-x-3 h-1.5 cursor-ns-resize" },
  { handle: "w", className: "left-0 inset-y-3 w-1.5 cursor-ew-resize" },
  { handle: "e", className: "right-0 inset-y-3 w-1.5 cursor-ew-resize" },
  { handle: "nw", className: "top-0 left-0 size-3 cursor-nwse-resize" },
  { handle: "ne", className: "top-0 right-0 size-3 cursor-nesw-resize" },
  { handle: "sw", className: "bottom-0 left-0 size-3 cursor-nesw-resize" },
  { handle: "se", className: "bottom-0 right-0 size-3 cursor-nwse-resize" },
]

/**
 * All window chrome lives here, so no feature component ever draws a title bar
 * or knows its breakpoint. Below `md` the same children render inside a
 * full-screen Sheet instead of a floating frame.
 *
 * Close is the only control. Minimise and maximise were removed along with the
 * dock: a window is either open or closed, so there is no state a user can put
 * one into and then fail to find again.
 */
export function WindowFrame({
  window: win,
  onClose,
  onFocus,
  onMove,
  escapeCloses = true,
  children,
}: WindowFrameProps) {
  const isMobile = useIsMobile()

  const { liveRect, isInteracting, dragProps, resizeProps } = useDragResize({
    rect: win.rect,
    minSize: win.minSize,
    disabled: isMobile,
    onCommit: onMove,
  })

  // Escape closes a non-modal window. Modal windows are dismissed by their own
  // affordances — an auth dialog you can Escape out of is not a gate.
  useEffect(() => {
    if (win.modal || !escapeCloses) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [win.modal, escapeCloses, onClose])

  if (isMobile) {
    return (
      <Sheet open onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="bottom" className="flex h-[100dvh] flex-col gap-0 p-0">
          <SheetHeader className="shrink-0 border-b border-border px-4 py-3">
            <SheetTitle className="text-sm font-medium">{win.title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <div
      role="dialog"
      aria-label={win.title}
      aria-modal={win.modal || undefined}
      onPointerDown={onFocus}
      style={{
        left: liveRect.x,
        top: liveRect.y,
        width: liveRect.w,
        height: liveRect.h,
        zIndex: win.zIndex,
      }}
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-xl border border-border",
        "bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl",
        isInteracting && "select-none",
      )}
    >
      <div
        {...dragProps}
        className="flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
      >
        <span className="truncate text-xs font-medium text-muted-foreground">{win.title}</span>
        {/* Inside the drag handle, and safe there only because `useDragResize`
            refuses to start a gesture on an interactive target — without that
            guard the handle's pointer capture swallows this button's click. */}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="size-6">
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {GRIPS.map(({ handle, className }) => (
        <div
          key={handle}
          data-testid={`resize-${handle}`}
          {...resizeProps(handle)}
          className={cn("absolute z-10", className)}
        />
      ))}
    </div>
  )
}
