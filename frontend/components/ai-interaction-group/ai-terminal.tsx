"use client"

import { useCallback } from "react"
import { cn } from "@/lib/utils"
import { useTerminalLines } from "./ai-terminal-components/use-terminal-lines"
import { useTerminalPalette } from "./ai-terminal-components/use-terminal-palette"
import { TerminalHeader } from "./ai-terminal-components/terminal-header"
import { TerminalOutput } from "./ai-terminal-components/terminal-output"
import { TerminalInput } from "./ai-terminal-components/terminal-input"

export interface AITerminalProps {
  className?: string
}

export function AITerminal({ className }: AITerminalProps) {
  const { lines, outputRef, appendLine, clearOutput, isSending } = useTerminalLines()
  const palette = useTerminalPalette(appendLine)

  const handleContainerClick = useCallback(() => {
    palette.inputRef.current?.focus()
  }, [palette.inputRef])

  const handleSuggestion = useCallback((text: string) => {
    palette.closePalette()
    palette.dispatchMessage(text)
  }, [palette.closePalette, palette.dispatchMessage])

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-zinc-700 text-zinc-100 opacity-85",
        className,
      )}
      onClick={handleContainerClick}
    >
      <TerminalHeader
        activeThreadTitle={palette.activeThreadTitle}
        isSending={isSending}
        onClearOutput={clearOutput}
      />
      <TerminalOutput
        lines={lines}
        isSending={isSending}
        outputRef={outputRef}
        onSuggestion={handleSuggestion}
      />
      <TerminalInput
        inputRef={palette.inputRef}
        inputValue={palette.inputValue}
        setInputValue={palette.setInputValue}
        paletteOpen={palette.paletteOpen}
        paletteMode={palette.paletteMode}
        paletteSelectedIndex={palette.paletteSelectedIndex}
        paletteQuery={palette.paletteQuery}
        filteredCommands={palette.filteredCommands}
        handleKeyDown={palette.handleKeyDown}
        handleCommandSelect={palette.handleCommandSelect}
        handleThreadSelect={palette.handleThreadSelect}
        closePalette={palette.closePalette}
        isSending={isSending}
        canChat={palette.canChat}
        threads={palette.threads}
        activeThreadId={palette.activeThreadId}
        isLoadingThreads={palette.isLoadingThreads}
      />
    </div>
  )
}
