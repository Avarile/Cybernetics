"use client"

import type { TerminalLine } from "./terminal-types"
import { TerminalHints } from "./terminal-hints"

export function TerminalOutputLine({
  line,
  onSuggestion,
}: {
  line: TerminalLine
  onSuggestion: (text: string) => void
}) {
  switch (line.type) {
    case "input":
      return (
        <div className="flex gap-2 font-mono text-sm leading-relaxed">
          <span className="shrink-0 select-none text-zinc-500">❯</span>
          <span className="whitespace-pre-wrap text-zinc-200">{line.text}</span>
        </div>
      )

    case "output":
      return (
        <div className="font-mono text-sm leading-relaxed">
          <div className="flex gap-2">
            <span className="shrink-0 select-none text-emerald-500">◆</span>
            <span className="flex-1 whitespace-pre-wrap text-zinc-100">{line.text}</span>
          </div>
          {line.ui && line.ui.length > 0 && (
            <TerminalHints ui={line.ui} onSuggestion={onSuggestion} />
          )}
          {line.sources && line.sources.length > 0 && (
            <div className="mt-1 border-l-2 border-zinc-700 pl-3 font-mono text-[10px] text-zinc-500">
              {line.sources.map((s, i) => (
                <div key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    [{i + 1}] {s.title}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )

    case "system":
      return (
        <div className="font-mono text-xs italic text-zinc-600 select-none">
          {line.text}
        </div>
      )

    case "error":
      return (
        <div className="flex gap-2 font-mono text-xs text-red-400">
          <span className="shrink-0 select-none">✗</span>
          <span className="whitespace-pre-wrap">{line.text}</span>
        </div>
      )
  }
}
