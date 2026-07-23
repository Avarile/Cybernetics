'use client'
import useSWR from 'swr'
import { agentService } from '@/lib/services/agent.service'
import type { Conversation } from '@/lib/interfaces/mastra.interface'
import type { Paginated } from '@/lib/interfaces/auth.interface'

export function useConversations(page = 1, limit = 30) {
  const { data, isLoading, error, mutate } = useSWR<Paginated<Conversation>>(
    ['agent', 'conversations', page, limit],
    () => agentService.listConversations(page, limit),
    { keepPreviousData: true },
  )
  return { conversations: data?.data ?? [], total: data?.total ?? 0, isLoading, error, mutate }
}
