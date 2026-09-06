"use client"

import { useEffect, type ReactNode } from "react"
import { MinusIcon, SquareIcon, XIcon } from "lucide-react"
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
  onMinimise: () => void
  onToggleMaximise: () => void
  onMove: (rect: Rect) => void
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
 */
export function WindowFrame({
  window: win,
  onClose,
  onFocus,
  onMinimise,
  onToggleMaximise,
  onMove,
  children,
}: WindowFrameProps) {
  const isMobile = useIsMobile()
  const isMaximised = win.state === "maximised"

  const { liveRect, isInteracting, dragProps, resizeProps } = useDragResize({
    rect: win.rect,
    minSize: win.minSize,
    disabled: isMobile || isMaximised,
    onCommit: onMove,
  })

  // Escape closes a non-modal window. Modal windows are dismissed by their own
  // affordances — an auth dialog you can Escape out of is not a gate.
  useEffect(() => {
    if (win.modal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [win.modal, onClose])

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
      style={
        isMaximised
          ? { left: 0, top: 0, right: 0, bottom: 0, zIndex: win.zIndex }
          : {
              left: liveRect.x,
              top: liveRect.y,
              width: liveRect.w,
              height: liveRect.h,
              zIndex: win.zIndex,
            }
      }
      className={cn(
        "absolute flex flex-col overflow-hidden rounded-xl border border-border",
        "bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur-xl",
        isInteracting && "select-none",
      )}
    >
      <div
        {...dragProps}
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2",
          isMaximised ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        )}
      >
        <span className="truncate text-xs font-medium text-muted-foreground">{win.title}</span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Minimise"
            onClick={onMinimise}
            className="size-6"
          >
            <MinusIcon className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Maximise"
            onClick={onToggleMaximise}
            className="size-6"
          >
            <SquareIcon className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onClose}
            className="size-6"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {!isMaximised &&
        GRIPS.map(({ handle, className }) => (
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
