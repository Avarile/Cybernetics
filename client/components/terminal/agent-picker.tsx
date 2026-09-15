"use client"

import { BotIcon, WrenchIcon } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import type { AgentDescriptor, AgentId } from "@/lib/agent/types"

/**
 * Which agent a conversation talks to.
 *
 * Disabled once the conversation has messages, because the binding is fixed at
 * creation server-side: Mastra memory is per-thread, so re-pointing a live
 * thread would hand a different persona the first one's working memory and
 * history. Rendering it disabled rather than hiding it keeps the current
 * binding visible, which is the more useful half of the control anyway.
 */
export function AgentPicker({
  agents,
  value,
  locked,
  onChange,
}: {
  agents: AgentDescriptor[]
  value: AgentId
  locked: boolean
  onChange: (id: AgentId) => void
}) {
  const current = agents.find((a) => a.id === value)

  return (
    <Select value={value} onValueChange={(v) => onChange(v as AgentId)} disabled={locked}>
      <SelectTrigger
        size="sm"
        className="h-7 w-auto gap-1.5 border-none text-xs shadow-none"
        aria-label="Agent"
        title={
          locked
            ? "The agent is fixed once a conversation has started. Start a new chat to change it."
            : (current?.description ?? "Choose an agent")
        }
      >
        {current?.hasTools ? (
          <WrenchIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        {/*
          The label is rendered directly rather than through `SelectValue`.
          Radix only learns an item's text when the portalled content mounts, so
          a closed picker that has never been opened shows the placeholder
          instead of the current agent — which is precisely the state the
          control spends most of its life in, and the only state it has at all
          once locked.
        */}
        <span className="truncate">{current?.name ?? "Agent"}</span>
      </SelectTrigger>
      <SelectContent align="start">
        {agents.map((a) => (
          <SelectItem
            key={a.id}
            value={a.id}
            textValue={a.name}
            className="items-start"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">{a.name}</span>
              <span className="max-w-64 text-xs text-muted-foreground">
                {a.description}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
