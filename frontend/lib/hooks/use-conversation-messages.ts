'use client'
import useSWR from 'swr'
import { agentService } from '@/lib/services/agent.service'
import type { ChatMessage } from '@/lib/interfaces/chat.interface'

/** Null id (a fresh chat) short-circuits — SWR skips fetching on a null key. */
export function useConversationMessages(conversationId: string | null) {
  const { data, isLoading, error } = useSWR<ChatMessage[]>(
    conversationId ? ['agent', 'conversation', conversationId, 'messages'] : null,
    () => agentService.getMessages(conversationId as string),
    { revalidateOnFocus: false },
  )
  return { messages: data ?? [], isLoading, error }
}
