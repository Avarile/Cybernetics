"use client"

import type { RefObject } from "react"
import type { TerminalLine } from "./terminal-types"
import { TerminalOutputLine } from "./terminal-output-line"

export function TerminalOutput({
  lines,
  isSending,
  outputRef,
  onSuggestion,
}: {
  lines: TerminalLine[]
  isSending: boolean
  outputRef: RefObject<HTMLDivElement | null>
  onSuggestion: (text: string) => void
}) {
  return (
    <div
      ref={outputRef}
      className="flex-1 space-y-2 overflow-y-auto p-4"
      style={{ minHeight: 0 }}
    >
      {lines.map((line) => (
        <TerminalOutputLine
          key={line.id}
          line={line}
          onSuggestion={onSuggestion}
        />
      ))}

      {isSending && (
        <div className="flex items-center gap-2 font-mono text-xs text-zinc-600">
          <span className="select-none">◆</span>
          <span className="flex gap-1">
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:0ms]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:150ms]" />
            <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-600 [animation-delay:300ms]" />
          </span>
        </div>
      )}
    </div>
  )
}
