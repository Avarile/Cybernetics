export type RunStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled'
export type ActionType = 'send_email' | 'db_write' | 'external_api' | 'other'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed' | 'failed'
export type DeliveryChannel = 'conversation' | 'email' | 'none'

export interface PendingApproval {
  toolCallId: string
  actionType: ActionType
  title: string
  payload: Record<string, unknown>
}

export interface ChatResult {
  conversationId: string
  runId: string
  text: string
  pendingApprovals: PendingApproval[]
}

export interface Conversation {
  id: string
  title: string | null
  createdAt: string
  updatedAt: string
}
