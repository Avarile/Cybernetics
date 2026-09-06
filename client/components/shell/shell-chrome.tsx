"use client"

import {
  LogOutIcon,
  MicIcon,
  RadarIcon,
  RotateCcwIcon,
  TerminalIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useApi } from "@/lib/api/provider"
import { cn } from "@/lib/utils"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"
import { useWindowStore } from "@/stores/window.store"

export interface ShellChromeProps {
  scannerVisible: boolean
  soundEnabled: boolean
  onToggleScanner: () => void
  onToggleSound: () => void
  onResetView: () => void
}

/**
 * The scene controls sit over a viewport that is a fixed dark stage in both
 * themes, so they use fixed light ink rather than semantic tokens — the same
 * carve-out palette.ts documents. Everything else in the chrome (the account
 * menu, the dock) is themed normally.
 */
const SCENE_BUTTON =
  "size-7 rounded-md p-0 text-white/45 hover:bg-white/10 hover:text-white " +
  "focus-visible:ring-white/50 focus-visible:ring-offset-0"

export function ShellChrome({
  scannerVisible,
  soundEnabled,
  onToggleScanner,
  onToggleSound,
  onResetView,
}: ShellChromeProps) {
  const { auth } = useApi()
  const principal = useAuthStore((s) => s.principal)
  const authed = useAuthStore(selectIsAuthenticated)
  const openWindow = useWindowStore((s) => s.openWindow)

  async function signOut() {
    const refresh = useAuthStore.getState().refreshToken
    if (refresh) await auth.logout(refresh).catch(() => undefined)
    useAuthStore.getState().clear()
    useWindowStore.getState().closeAll()
    useWindowStore.getState().openWindow({ kind: "auth", title: "Access", modal: true })
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-3">
        <span className="pointer-events-auto select-none text-xs font-semibold tracking-widest text-white/60">
          ◆ CYBERNETICS
        </span>

        {authed && (
          <div className="pointer-events-auto flex items-center gap-1">
            <div
              role="toolbar"
              aria-label="System core"
              aria-orientation="horizontal"
              className="mr-1 flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5 backdrop-blur-sm"
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Scanner"
                    aria-pressed={scannerVisible}
                    onClick={onToggleScanner}
                    className={cn(SCENE_BUTTON, scannerVisible && "text-white")}
                  >
                    <RadarIcon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Scanner</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={soundEnabled ? "Mute core" : "Unmute core"}
                    aria-pressed={soundEnabled}
                    onClick={onToggleSound}
                    className={cn(SCENE_BUTTON, soundEnabled && "text-white")}
                  >
                    {soundEnabled ? (
                      <Volume2Icon className="size-3.5" />
                    ) : (
                      <VolumeXIcon className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{soundEnabled ? "Mute core" : "Unmute core"}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Reset view"
                    onClick={onResetView}
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
