"use client"

import type { RefObject } from "react"
import { cn } from "@/lib/utils"
import type { IThread } from "@/lib/interfaces/mastra.interface"
import {
  CommandPalette,
  type CommandId,
  type TerminalCommandDef,
} from "@/components/ai-elements/code/terminal-command-palette"

export interface TerminalInputProps {
  inputRef: RefObject<HTMLInputElement | null>
  inputValue: string
  setInputValue: (v: string) => void
  paletteOpen: boolean
  paletteMode: "commands" | "sessions"
  paletteSelectedIndex: number
  paletteQuery: string
  filteredCommands: TerminalCommandDef[]
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleCommandSelect: (id: CommandId) => void
  handleThreadSelect: (thread: IThread) => void
  closePalette: () => void
  isSending: boolean
  canChat: boolean
  threads: IThread[]
  activeThreadId: string | null
  isLoadingThreads: boolean
}

export function TerminalInput({
  inputRef,
  inputValue,
  setInputValue,
  paletteOpen,
  paletteMode,
  paletteSelectedIndex,
  paletteQuery,
  filteredCommands,
  handleKeyDown,
  handleCommandSelect,
  handleThreadSelect,
  closePalette,
  isSending,
  canChat,
  threads,
  activeThreadId,
  isLoadingThreads,
}: TerminalInputProps) {
  return (
    <div
      className="relative shrink-0 border-t border-zinc-800"
      onClick={(e) => e.stopPropagation()}
    >
      {paletteOpen && (
        <CommandPalette
          query={paletteQuery}
          mode={paletteMode}
          selectedIndex={paletteSelectedIndex}
          threads={threads}
          activeThreadId={activeThreadId}
          isLoadingThreads={isLoadingThreads}
          onCommandSelect={handleCommandSelect}
          onThreadSelect={handleThreadSelect}
          onDismiss={closePalette}
        />
      )}

      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="shrink-0 select-none font-mono text-sm text-zinc-500">
          ❯
        </span>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isSending || !canChat}
          placeholder={
            canChat
              ? "Type a message… or / for commands"
              : "Waiting for agent…"
          }
          className={cn(
            "flex-1 bg-transparent font-mono text-sm text-zinc-100 outline-none",
            "placeholder:text-zinc-700",
            "disabled:cursor-not-allowed disabled:opacity-50",
            paletteOpen && "text-green-400",
          )}
        />
        {inputValue && (
          <span className="shrink-0 select-none font-mono text-[10px] text-zinc-700">
            ↵ send
          </span>
        )}
      </div>
    </div>
  )
}
