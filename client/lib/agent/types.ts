/**
 * The agent wire contract, hand-mirrored from the backend.
 *
 * Sources, all under `api/src/features/mastra/`:
 *   SseEvent, ActionType   → services/chunk-to-sse.ts, mastra.types.ts
 *   ChatMessageDto + parts → services/message-mapper.ts
 *   PublicConversation     → services/conversation.service.ts
 *   PendingApprovalRow     → infrastructure/database/schema/agent.schema.ts
 *
 * Copied rather than imported: the client does not depend on api/. A contract
 * test (`sse.contract.test.ts`) reads chunk-to-sse.ts and fails if the variant
 * names here drift from it.
 */

export type ActionType = "send_email" | "db_write" | "external_api" | "other"

export type RunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "succeeded"
  | "failed"
  | "cancelled"

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "executed"
  | "failed"

/** The terminal statuses a `done` frame can carry. */
export type DoneStatus = "succeeded" | "awaiting_approval" | "cancelled" | "failed"

/** Verbatim from `chunk-to-sse.ts`. */
export type SseEvent =
  | { type: "start"; conversationId: string; runId: string }
  | { type: "text-delta"; delta: string }
  | { type: "reasoning-delta"; delta: string }
  | { type: "tool-input"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool-output"
      toolCallId: string
      toolName: string
      result: unknown
      isError: boolean
    }
  | {
      type: "approval-required"
      approvalId: string
      toolCallId: string
      toolName: string
      actionType: ActionType
      title: string
      payload: Record<string, unknown>
    }
  | { type: "error"; message: string }
  | { type: "done"; status: DoneStatus }

/** Every `type` the union carries. Used by the contract test. */
export const SSE_EVENT_TYPES = [
  "start",
  "text-delta",
  "reasoning-delta",
  "tool-input",
  "tool-output",
  "approval-required",
  "error",
  "done",
] as const

// ── Stored history (`GET /agent/conversations/:id/messages`) ────────────────

export type ChatMessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool"
      toolCallId: string
      toolName: string
      state: string
      input?: unknown
      output?: unknown
      errorText?: string
    }
  | {
      type: "source"
      sourceId?: string
      title?: string
      url?: string
      mediaType?: string
    }

export interface ChatMessageDto {
  id: string
  role: "user" | "assistant" | "system"
  createdAt: string
  parts: ChatMessagePart[]
}

// ── Conversations (`GET /agent/conversations`) ──────────────────────────────

export type ConversationKind = "chat" | "scheduled" | "event"

export interface PublicConversation {
  id: string
  title: string | null
  kind: ConversationKind
  status: string
  lastMessageAt: string | null
  messageCount: number
  createdAt: string
  updatedAt: string
}

// ── Approvals (`GET /agent/approvals`) ──────────────────────────────────────

/** A row of `agent_approval`, as the list endpoint returns it. */
export interface PendingApprovalRow {
  id: string
  runId: string
  conversationId: string | null
  toolCallId: string | null
  actionType: ActionType
  title: string
  payload: Record<string, unknown>
  status: ApprovalStatus
  expiresAt: string | null
  createdAt: string
}

// ── The request body (`POST /agent/chat/stream`) ────────────────────────────

/**
 * `chatStreamSchema` has a `.refine` demanding exactly one of `message` or
 * `resume`. Modelled as a discriminated union so the invalid shape cannot be
 * constructed here, rather than discovered as a 422.
 */
export type ChatStreamRequest =
  | { conversationId?: string; message: string }
  | { conversationId?: string; resume: { approvalId: string; approved: boolean } }

/** Backend caps the message at 8000 characters (`chatStreamSchema`). */
export const MESSAGE_MAX_LENGTH = 8000
