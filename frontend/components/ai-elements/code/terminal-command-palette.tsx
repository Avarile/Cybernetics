"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import type { IThread } from "@/lib/interfaces/mastra.interface"

// ── Command definitions ───────────────────────────────────────────────────────

export type CommandId = "/sessions" | "/clear" | "/skills" | "/sub-agents"

export interface TerminalCommandDef {
  id: CommandId
  label: string
  description: string
}

export const TERMINAL_COMMANDS: TerminalCommandDef[] = [
  {
    id: "/sessions",
    label: "/sessions",
    description: "Browse and switch conversation threads",
  },
  {
    id: "/clear",
    label: "/clear",
    description: "Start a fresh conversation session",
  },
  {
    id: "/skills",
    label: "/skills",
    description: "Ask the agent to list its available skills",
  },
  {
    id: "/sub-agents",
    label: "/sub-agents",
    description: "Ask the agent to list its sub-agents",
  },
]

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  /** Text typed after the leading "/" — used to filter the command list */
  query: string
  /** Which panel to show */
  mode: "commands" | "sessions"
  /** Row currently highlighted (controlled by parent via arrow keys) */
  selectedIndex: number
  /** Full thread list for /sessions mode */
  threads: IThread[]
  /** Currently active thread id — highlighted green in the list */
  activeThreadId: string | null
  isLoadingThreads: boolean
  onCommandSelect: (id: CommandId) => void
  onThreadSelect: (thread: IThread) => void
  onDismiss: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandPalette({
  query,
  mode,
  selectedIndex,
  threads,
  activeThreadId,
  isLoadingThreads,
  onCommandSelect,
  onThreadSelect,
}: CommandPaletteProps) {
  const selectedRef = useRef<HTMLButtonElement>(null)

  // Keep selected item scrolled into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // ── Sessions mode ───────────────────────────────────────────────────────────
  if (mode === "sessions") {
    return (
      <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-1.5">
          <span className="font-mono text-xs text-zinc-400">
            <span className="text-green-400">/sessions</span>
            <span className="ml-2 text-zinc-600">— select a thread</span>
          </span>
          <span className="font-mono text-[10px] text-zinc-600">
            ↑↓ navigate &nbsp;↵ open &nbsp;esc back
          </span>
        </div>

        <div className="max-h-56 overflow-y-auto">
          {isLoadingThreads ? (
            <div className="px-3 py-2 font-mono text-xs text-zinc-500">
              Loading threads…
            </div>
          ) : threads.length === 0 ? (
            <div className="px-3 py-2 font-mono text-xs text-zinc-500">
              No threads found.
            </div>
          ) : (
            threads.map((thread, i) => (
              <button
                key={thread.id}
                ref={i === selectedIndex ? selectedRef : null}
                type="button"
                onClick={() => onThreadSelect(thread)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-xs transition-colors",
                  i === selectedIndex
                    ? "bg-zinc-700 text-zinc-100"
                    : "text-zinc-300 hover:bg-zinc-800",
                  activeThreadId === thread.id &&
                    i !== selectedIndex &&
                    "text-green-400",
                )}
              >
                <span className="w-3 shrink-0 text-center text-zinc-500">
                  {i === selectedIndex ? "▶" : activeThreadId === thread.id ? "●" : " "}
                </span>
                <span className="flex-1 truncate">
                  {thread.title ?? "Untitled"}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-600">
                  {new Date(thread.updatedAt).toLocaleDateString()}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    )
  }

  // ── Commands mode ───────────────────────────────────────────────────────────
  const filtered = TERMINAL_COMMANDS.filter(
    (c) => !query || c.id.toLowerCase().includes(`/${query.toLowerCase()}`),
  )

  if (filtered.length === 0) return null

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-1 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-xl">
      <div className="flex items-center justify-between border-b border-zinc-700 px-3 py-1.5">
        <span className="font-mono text-xs text-zinc-400">commands</span>
        <span className="font-mono text-[10px] text-zinc-600">
          ↑↓ navigate &nbsp;↵ select &nbsp;esc dismiss
        </span>
      </div>

      <div className="overflow-y-auto">
        {filtered.map((cmd, i) => (
          <button
            key={cmd.id}
            ref={i === selectedIndex ? selectedRef : null}
            type="button"
            onClick={() => onCommandSelect(cmd.id)}
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left font-mono text-xs transition-colors",
              i === selectedIndex
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-300 hover:bg-zinc-800",
            )}
          >
            <span className="w-3 shrink-0 text-center text-zinc-500">
              {i === selectedIndex ? "▶" : " "}
            </span>
            <span className="w-28 shrink-0 text-green-400">{cmd.label}</span>
            <span className="flex-1 text-zinc-500">{cmd.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
