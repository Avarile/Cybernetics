import { apiClient } from '@/lib/http/api-client'
import type { ChatResult, Conversation, PendingApproval } from '@/lib/interfaces/mastra.interface'
import type { Paginated } from '@/lib/interfaces/auth.interface'

export const agentService = {
  chat(input: { conversationId?: string; message: string }): Promise<ChatResult> {
    return apiClient.post<ChatResult>('/agent/chat', input).then((r) => r.data)
  },
  listConversations(page = 1, limit = 20): Promise<Paginated<Conversation>> {
    return apiClient
      .get<Paginated<Conversation>>('/agent/conversations', { params: { page, limit } })
      .then((r) => r.data)
  },
  listApprovals(): Promise<PendingApproval[]> {
    return apiClient.get<PendingApproval[]>('/agent/approvals').then((r) => r.data)
  },
  decideApproval(id: string, input: { approved: boolean; note?: string }): Promise<unknown> {
    return apiClient.post(`/agent/approvals/${id}`, input).then((r) => r.data)
  },
}
