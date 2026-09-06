import type {
  ChatMessageDto,
  PendingApprovalRow,
  PublicConversation,
} from "@/lib/agent/types"
import type { ApiClient } from "../client"
import type { Paginated } from "../types"

/**
 * Typed wrappers over `api/src/features/mastra/controllers/`.
 *
 * The streaming turn is NOT here — it cannot go through ApiClient, which
 * buffers the whole body to parse JSON. See `lib/agent/stream.ts`.
 */
export function createAgentApi(client: ApiClient) {
  return {
    /** `chat.controller.ts` — page/limit per listConversationsSchema. */
    listConversations: (page = 1, limit = 20) =>
      client.get<Paginated<PublicConversation>>(
        `/agent/conversations?page=${page}&limit=${limit}`,
      ),

    messages: (conversationId: string) =>
      client.get<ChatMessageDto[]>(`/agent/conversations/${conversationId}/messages`),

    /** Non-streaming turn. Kept for callers that do not need incremental
     *  output; the terminal uses the stream. */
    chat: (body: { conversationId?: string; message: string }) =>
      client.post<unknown>("/agent/chat", body),

    /** `approval.controller.ts` — pending approvals for the current owner. */
    listApprovals: () => client.get<PendingApprovalRow[]>("/agent/approvals"),

    /**
     * Out-of-band decision, per `decisionSchema`. Distinct from resuming
     * inline: this decides an approval without continuing the turn's stream,
     * for a run started elsewhere or decided from the notifications window.
     */
    decideApproval: (id: string, body: { approved: boolean; note?: string }) =>
      client.post<unknown>(`/agent/approvals/${id}`, body),
  }
}

export type AgentApi = ReturnType<typeof createAgentApi>
