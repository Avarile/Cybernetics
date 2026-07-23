'use client'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useConversations } from '@/lib/hooks/use-conversations'

interface Props {
  activeId: string | null
  onSelect: (id: string | null) => void
}

export function ConversationHistoryRail({ activeId, onSelect }: Props) {
  const { conversations, isLoading } = useConversations()
  return (
    <div className="flex h-full w-64 flex-col gap-2 border-r p-2">
      <Button variant="outline" className="justify-start gap-2" onClick={() => onSelect(null)}>
        <HugeiconsIcon icon={PlusSignIcon} className="size-4" strokeWidth={2} />
        New chat
      </Button>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1">
          {isLoading && <p className="px-2 py-1 text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && conversations.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">No conversations yet</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={cn(
                'truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent',
                c.id === activeId && 'bg-accent font-medium',
              )}
            >
              {c.title || 'Untitled conversation'}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
