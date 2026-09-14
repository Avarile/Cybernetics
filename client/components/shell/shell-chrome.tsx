"use client"

import {
  DatabaseIcon,
  LogOutIcon,
  MaximizeIcon,
  MicIcon,
  MinimizeIcon,
  PanelRightIcon,
  RotateCcwIcon,
  TerminalIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MODULE_PANEL_PR } from "@/components/shell/panel-metrics"
import { useFullscreen } from "@/hooks/use-fullscreen"
import { useSignOut } from "@/features/session/use-sign-out"
import { useSession } from "@/features/session/use-session"
import { useSceneControls } from "@/features/workspace/use-scene-controls"
import { useWorkspace } from "@/features/workspace/use-workspace"
import { cn } from "@/lib/utils"

/**
 * The scene controls sit over a viewport that is a fixed dark stage in both
 * themes, so they use fixed light ink rather than semantic tokens — the same
 * carve-out palette.ts documents. Everything else in the chrome (the account
 * menu, the dock) is themed normally.
 */
const SCENE_BUTTON =
  "size-7 rounded-md p-0 text-white/45 hover:bg-white/10 hover:text-white " +
  "focus-visible:ring-white/50 focus-visible:ring-offset-0"

export function ShellChrome() {
  const { principal, authed } = useSession()
  const { openWindow } = useWorkspace()
  const { panelOpen, togglePanel, resetView } = useSceneControls()
  const fullscreen = useFullscreen()
  const signOut = useSignOut()

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3">
        <span className="pointer-events-auto select-none text-xs font-semibold tracking-widest text-white/60">
          ◆ CYBERNETICS
        </span>

        {authed && (
          // The panel paints over this bar (z-30 against our z-20), so while it
          // is open the cluster steps aside by exactly the rail's width. Without
          // this the buttons would still be *there* — just unreachable
          // underneath, and that includes the toggle that closes the panel.
          <div
            className={cn(
              "pointer-events-auto flex items-center gap-1",
              panelOpen && MODULE_PANEL_PR,
            )}
          >
            <div
              role="toolbar"
              aria-label="System core"
              aria-orientation="horizontal"
              className="mr-1 flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5 backdrop-blur-sm"
            >
              {/* Three viewport controls: Toggle module panel / full screen /
                  Reset view. The middle slot was the reference's "Scanner deck"
                  toggle; the deck is the stack's floor rather than a view
                  option, so the slot went to something worth a click. (The
                  reference's fourth, Close, dismissed its modal — the core here
                  is the surface itself, so there is nothing to close.) */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Toggle module panel"
                    aria-pressed={panelOpen}
                    onClick={togglePanel}
                    className={cn(SCENE_BUTTON, panelOpen && "text-white")}
                  >
                    <PanelRightIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Module panel</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={fullscreen.active ? "Exit full screen" : "Enter full screen"}
                    aria-pressed={fullscreen.active}
                    onClick={fullscreen.toggle}
                    className={cn(SCENE_BUTTON, fullscreen.active && "text-white")}
                  >
                    {fullscreen.active ? (
                      <MinimizeIcon className="size-3.5" />
                    ) : (
                      <MaximizeIcon className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {fullscreen.active ? "Exit full screen" : "Full screen"}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Reset view"
                    onClick={resetView}
                    className={SCENE_BUTTON}
                  >
                    <RotateCcwIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Reset view</TooltipContent>
              </Tooltip>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => openWindow({ kind: "data" })}
            >
              <DatabaseIcon className="size-3.5" /> Data
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => openWindow({ kind: "terminal", title: "Terminal" })}
            >
              <TerminalIcon className="size-3.5" /> Terminal
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                >
                  {principal?.displayName ?? principal?.email ?? "Account"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={signOut}>
                  <LogOutIcon className="size-3.5" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {authed && (
        <Button
          size="icon"
          aria-label="Live conversation"
          onClick={() => openWindow({ kind: "voice", title: "Live" })}
          className="pointer-events-auto absolute bottom-14 right-4 z-20 size-11 rounded-full shadow-lg"
        >
          <MicIcon className="size-4" />
        </Button>
      )}
    </>
  )
}
