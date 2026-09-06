"use client"

import { LogOutIcon, MicIcon, TerminalIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useApi } from "@/lib/api/provider"
import { selectIsAuthenticated, useAuthStore } from "@/stores/auth.store"
import { useWindowStore } from "@/stores/window.store"

export function ShellChrome() {
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
        <span className="pointer-events-auto select-none text-xs font-semibold tracking-widest text-muted-foreground">
          ◆ CYBERNETICS
        </span>

        {authed && (
          <div className="pointer-events-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => openWindow({ kind: "terminal", title: "Terminal" })}
            >
              <TerminalIcon className="size-3.5" /> Terminal
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs">
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
