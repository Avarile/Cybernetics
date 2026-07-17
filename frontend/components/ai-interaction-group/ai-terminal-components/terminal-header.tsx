"use client"

import { TerminalIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"

export function TerminalHeader({
  activeThreadTitle,
  isSending,
  onClearOutput,
}: {
  activeThreadTitle: string | null
  isSending: boolean
  onClearOutput: () => void
}) {
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-4 py-2">
      <div className="flex items-center gap-2 font-mono text-sm text-zinc-400">
        <TerminalIcon className="size-4" />
        <span>
          {activeThreadTitle
            ? `terminal — ${activeThreadTitle}`
            : "terminal"}
        </span>
        {isSending && (
          <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          onClick={(e) => { e.stopPropagation(); onClearOutput() }}
          className="size-7 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          title="Clear terminal output"
        >
          <Trash2Icon size={13} />
        </Button>
      </div>
    </div>
  )
}
