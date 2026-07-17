"use client"

import { cn } from "@/lib/utils"
import type { IUIHint } from "@/lib/interfaces/mastra.interface"

export function TerminalHints({
  ui,
  onSuggestion,
}: {
  ui: IUIHint[]
  onSuggestion: (text: string) => void
}) {
  if (!ui || ui.length === 0) return null
  return (
    <div className="mt-1 space-y-1 border-l-2 border-zinc-700 pl-3">
      {ui.map((hint, i) => {
        switch (hint.type) {
          case "reasoning":
            return (
              <details key={i} className="group">
                <summary className="cursor-pointer list-none font-mono text-[10px] text-zinc-500 hover:text-zinc-400">
                  <span className="group-open:hidden">▶ reasoning</span>
                  <span className="hidden group-open:inline">▼ reasoning</span>
                </summary>
                <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-zinc-600 leading-relaxed">
                  {hint.content}
                </pre>
              </details>
            )

          case "chain_of_thought":
            return (
              <div key={i} className="font-mono text-[10px] text-zinc-500">
                <div className="mb-0.5 text-zinc-600">chain of thought</div>
                {hint.steps.map((s, si) => (
                  <div key={si} className="flex items-start gap-1">
                    <span
                      className={cn(
                        "shrink-0",
                        s.status === "complete"
                          ? "text-green-600"
                          : s.status === "active"
                          ? "text-yellow-500"
                          : "text-zinc-700",
                      )}
                    >
                      {s.status === "complete" ? "✓" : s.status === "active" ? "◉" : "○"}
                    </span>
                    <span
                      className={cn(
                        s.status === "complete" ? "text-zinc-500 line-through" : "text-zinc-400",
                      )}
                    >
                      {s.label}
                      {s.description && (
                        <span className="ml-1 text-zinc-600">— {s.description}</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )

          case "plan":
            return (
              <div key={i} className="font-mono text-[10px]">
                <div className="text-zinc-400">{hint.title}</div>
                {hint.description && (
                  <div className="text-zinc-600">{hint.description}</div>
                )}
                {hint.steps.map((s, si) => (
                  <div key={si} className="flex items-start gap-1">
                    <span className="shrink-0 text-zinc-600">{si + 1}.</span>
                    <span
                      className={cn(
                        s.status === "complete"
                          ? "text-zinc-600 line-through"
                          : s.status === "active"
                          ? "text-yellow-400"
                          : "text-zinc-400",
                      )}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            )

          case "queue":
            return (
              <div key={i} className="font-mono text-[10px]">
                {hint.title && <div className="text-zinc-500">{hint.title}</div>}
                {hint.items.map((item) => (
                  <div key={item.id} className="flex items-start gap-1">
                    <span className={cn("shrink-0", item.completed ? "text-green-600" : "text-zinc-600")}>
                      {item.completed ? "☑" : "☐"}
                    </span>
                    <span className={cn(item.completed ? "text-zinc-600 line-through" : "text-zinc-400")}>
                      {item.title}
                    </span>
                  </div>
                ))}
              </div>
            )

          case "suggestions":
            return (
              <div key={i} className="flex flex-wrap gap-1.5 pt-0.5">
                {hint.items.map((s, si) => (
                  <button
                    key={si}
                    type="button"
                    onClick={() => onSuggestion(s)}
                    className="rounded border border-zinc-700 px-2 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-200"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )

          case "confirmation":
            return (
              <div key={i} className="font-mono text-[10px] text-yellow-500">
                ⚠ {hint.message}
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onSuggestion("Yes, please proceed.")}
                    className="rounded border border-green-700 px-2 py-0.5 text-green-400 hover:bg-green-900/30"
                  >
                    approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onSuggestion("No, please cancel.")}
                    className="rounded border border-red-800 px-2 py-0.5 text-red-400 hover:bg-red-900/30"
                  >
                    reject
                  </button>
                </div>
              </div>
            )

          default:
            return null
        }
      })}
    </div>
  )
}
