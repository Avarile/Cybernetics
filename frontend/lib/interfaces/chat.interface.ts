export type ChatRole = 'user' | 'assistant' | 'system'

/** Tool-invocation UI states — the AI Elements ToolHeader union (v5). History from the
 *  backend may carry v4-ish states ('call'/'result'); normalize with normalizeToolState. */
export type ChatToolState =
  | 'input-streaming' | 'input-available' | 'approval-requested'
  | 'approval-responded' | 'output-available' | 'output-denied' | 'output-error'

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; toolCallId: string; toolName: string; state: string; input?: unknown; output?: unknown; errorText?: string }
  | { type: 'source'; sourceId?: string; title?: string; url?: string; mediaType?: string }

/** The unified chat message — identical to the backend GET .../messages DTO. */
export interface ChatMessage {
  id: string
  role: ChatRole
  parts: ChatPart[]
  createdAt?: string
}

/** A HITL approval surfaced mid-stream. */
export interface UiApproval {
  approvalId: string
  toolCallId: string
  toolName: string
  actionType: string
  title: string
  payload: Record<string, unknown>
}

export type SseEvent =
  | { type: 'start'; conversationId: string; runId: string }
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-input'; toolCallId: string; toolName: string; args: unknown }
  | { type: 'tool-output'; toolCallId: string; toolName: string; result: unknown; isError: boolean }
  | { type: 'approval-required'; approvalId: string; toolCallId: string; toolName: string; actionType: string; title: string; payload: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'done'; status: 'succeeded' | 'awaiting_approval' | 'cancelled' | 'failed' }

export interface ChatStreamBody {
  conversationId?: string
  message?: string
  resume?: { approvalId: string; approved: boolean }
}
