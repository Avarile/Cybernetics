"use client"

import { Suspense, useEffect } from "react"
import { XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useViewportSync, useWorkspace } from "@/features/workspace/use-workspace"
import { WINDOW_META } from "@/lib/windows/meta"
import { WINDOW_COMPONENTS } from "@/lib/windows/registry"
import type { WindowInstance } from "@/lib/windows/types"
import { MODAL_SCRIM_Z } from "@/stores/workspace.store"
import { WindowFrame } from "./window-frame"

/**
 * Escape dismisses the topmost window — and only that one.
 *
 * This used to live in WindowFrame, where every open frame registered its own
 * document listener: one Escape then closed all of them at once, and a
 * chromeless window (which draws no frame) answered to nothing at all. A
 * single listener over the z-ordered list makes the gesture mean "dismiss
 * what is in front of me", which is the only reading that survives more than
 * one window being open.
 */
function useEscapeToDismiss(windows: WindowInstance[], closeWindow: (id: string) => void): void {
  useEffect(() => {
    // `windows` arrives ascending by zIndex and modals occupy the higher band,
    // so the last entry is always the one the user is actually looking at.
    const top = windows.at(-1)
    if (!top) return

    const onKey = (e: KeyboardEvent) => {
      // A select, combobox or popover inside a window body handles Escape
      // first and marks it handled. Closing on the same keystroke would take
      // the menu and the window it belongs to away together.
      if (e.key !== "Escape" || e.defaultPrevented) return
      closeWindow(top.id)
    }

    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [windows, closeWindow])
}

/**
 * One window's rendering, split out from WindowLayer because it needs
 * `useWindowControls(win.id)` — a hook, which cannot be called inside the
 * `.map()` below without breaking the rules of hooks across a list whose
 * length changes as windows open and close.
 */
function WindowItem({ win }: { win: WindowInstance }) {
  const { close, focus, minimise, toggleMaximise, move } = useWindowControls(win.id)
  const Body = WINDOW_COMPONENTS[win.kind]
  // A kind declared but not yet registered simply does not render.
  if (!Body) return null
  const meta = WINDOW_META[win.kind]

  const body = (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      }
    >
      {/* __windowId lets a body close itself — the confirm dialog
          dismisses on success without the opener holding a handle. */}
      <Body {...(win.props ?? {})} kind={win.kind} __windowId={win.id} />
    </Suspense>
  )

  // A chromeless window is centred here rather than placed by rect, and gets
  // no frame at all. The auth gate is the case: its body is already a Card, so
  // a frame around it is a box in a box.
  //
  // Centring is `min-h-full` inside a scrollable `inset-0` parent, not
  // `place-items-center`: on a short viewport (a phone in landscape) a
  // tall card then scrolls instead of being clipped at both ends. The
  // same classes also make it responsive without `useIsMobile`, so the
  // full-height mobile Sheet in WindowFrame never applies to a login.
  if (meta?.chrome === "none") {
    return (
      <div style={{ zIndex: win.zIndex }} className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4 sm:p-6 md:p-10">
          <div
            role="dialog"
            aria-modal={win.modal || undefined}
            aria-label={win.title}
            onPointerDown={focus}
            className="pointer-events-auto relative w-full max-w-sm"
          >
            {/*
              No title bar means nowhere to hang the window controls, so Close
              floats over the body's own top-right corner. Chromeless is a
              statement about decoration, not about whether the user is allowed
              to leave: the auth gate used to have no way out but signing in,
              which left a dismissed-looking dialog permanently over the core.
              Closing it does not grant anything — the surface behind stays
              dimmed and inert, and "Sign in" in the chrome brings it back.
            */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={close}
              className="absolute top-2 right-2 z-10 size-7 text-muted-foreground"
            >
              <XIcon className="size-3.5" />
            </Button>
            {body}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pointer-events-auto">
      <WindowFrame
        window={win}
        onClose={close}
        onFocus={focus}
        onMinimise={minimise}
        onToggleMaximise={toggleMaximise}
        onMove={move}
      >
        {body}
      </WindowFrame>
    </div>
  )
}

export function WindowLayer() {
  const { windows, topModal, closeWindow } = useWorkspace()
  useViewportSync()
  useEscapeToDismiss(windows, closeWindow)

  if (windows.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {topModal && (
        // A fixed dark scrim, not `bg-background/60`. What sits underneath is
        // always the theme-exempt dark canvas (design §4.3), so a themed scrim
        // washes it to grey in light mode and erases the machine behind the
        // dialog — the opposite of the intended "it's there, just not yours yet".
        //
        // The zIndex is load-bearing. Every window carries an explicit zIndex,
        // so a scrim with `auto` loses to all of them and dims nothing but the
        // canvas — non-modal windows kept painting over it at full brightness.
        // MODAL_Z_BASE - 1 puts it under the modal band and over everything else.
        //
        // Pointer-down on it dismisses the modal it belongs to: clicking away
        // from a dialog is the gesture people try first, and a scrim that only
        // swallows the click reads as a frozen app.
        <div
          style={{ zIndex: MODAL_SCRIM_Z }}
          onPointerDown={() => closeWindow(topModal.id)}
          className="pointer-events-auto absolute inset-0 bg-black/50 backdrop-blur-sm"
        />
      )}
      {windows.map((win) => (
        <WindowItem key={win.id} win={win} />
      ))}
    </div>
  )
}
