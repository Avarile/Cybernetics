"use client"

import { PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { PublicConversation } from "@/lib/agent/types"

export function ConversationRail({
  conversations,
  status,
  error,
  activeId,
  onSelect,
  onNew,
}: {
  conversations: PublicConversation[]
  status: "idle" | "loading" | "ready" | "error"
  error: string | null
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  return (
    <div className="flex h-full min-h-0 w-56 shrink-0 flex-col border-r border-border">
      <div className="shrink-0 p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-1.5 text-xs"
          onClick={onNew}
        >
          <PlusIcon className="size-3.5" />
          New chat
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {status === "loading" && (
          <div className="flex flex-col gap-1.5 pt-1">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}

        {status === "error" && (
          <p role="alert" className="px-1 py-2 text-xs text-destructive">
            {error ?? "Could not load conversations"}
          </p>
        )}

        {status === "ready" && conversations.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">No conversations yet.</p>
        )}

        {conversations.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            aria-current={c.id === activeId ? "true" : undefined}
            className={cn(
              "block w-full truncate rounded-md px-2 py-1.5 text-left text-xs",
              "hover:bg-accent hover:text-accent-foreground",
              c.id === activeId && "bg-accent text-accent-foreground",
            )}
          >
            {c.title ?? "Untitled"}
          </button>
        ))}
      </div>
    </div>
  )
}
