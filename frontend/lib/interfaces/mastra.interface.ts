// ============================================================================
// Agent
// ============================================================================

export interface IAgent {
  id: string
  name: string
  description?: string
  instructions?: string
}

// ============================================================================
// Thread
// ============================================================================

export interface IThread {
  id: string
  title: string | null
  resourceId: string
  /** Not returned by the threads endpoint — stored client-side when known. */
  agentId?: string
  createdAt: string
  updatedAt: string
  metadata?: Record<string, unknown> | null
}

export interface IThreadsPayload {
  threads: IThread[]
  total: number
  page: number
  perPage: number
  hasMore: boolean
}

// ============================================================================
// Messages
// ============================================================================

export type ChatRole = 'user' | 'assistant'

// ── UI hint types ─────────────────────────────────────────────────────────────
// The agent embeds these in its JSON response to drive rich UI components.

export interface IReasoningHint {
  type: 'reasoning'
  content: string
}

export interface IPlanStep {
  label: string
  status?: 'pending' | 'active' | 'complete'
}

export interface IPlanHint {
  type: 'plan'
  title: string
  description?: string
  steps: IPlanStep[]
}

export interface IChainOfThoughtStep {
  label: string
  description?: string
  status?: 'complete' | 'active' | 'pending'
}

export interface IChainOfThoughtHint {
  type: 'chain_of_thought'
  steps: IChainOfThoughtStep[]
}

export interface IQueueItem {
  id: string
  title: string
  description?: string
  completed: boolean
}

export interface IQueueHint {
  type: 'queue'
  title?: string
  items: IQueueItem[]
}

export interface ISuggestionsHint {
  type: 'suggestions'
  items: string[]
}

export interface IConfirmationHint {
  type: 'confirmation'
  message: string
  /** Agent always sets "approval-requested"; client updates to "approval-responded" */
  state: 'approval-requested' | 'approval-responded'
}

export type IUIHint =
  | IReasoningHint
  | IPlanHint
  | IChainOfThoughtHint
  | IQueueHint
  | ISuggestionsHint
  | IConfirmationHint

export interface ICitationSource {
  title: string
  url: string
  description?: string
}

/** Normalised in-memory representation used by the UI. */
export interface IChatMessage {
  id: string
  role: ChatRole
  content: string
  timestamp: Date
  /** Filenames that were attached and whose text was inlined into the message */
  attachedFiles?: string[]
  /** Structured UI hints parsed from the agent's JSON envelope */
  ui?: IUIHint[]
  /** Web sources the agent cited */
  sources?: ICitationSource[]
}

// ============================================================================
// API response shapes (as returned by the backend IBaseResponse wrapper)
// ============================================================================

export interface IInitSessionPayload {
  text: string
  threadId: string
}

export interface IContinueSessionPayload {
  text: string
}

/** A tool invocation stored inside a tool-invocation part or toolInvocations array */
export interface IToolInvocation {
  state: string
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  result?: unknown
}

/** A single part inside IRawMessageContent.parts */
export interface IRawMessagePart {
  type: 'text' | 'reasoning' | 'tool-invocation' | string
  /** Present when type === 'text' */
  text?: string
  /** Present when type === 'reasoning' */
  reasoning?: string
  details?: { type: string; text: string }[]
  providerMetadata?: Record<string, unknown>
  /** Present when type === 'tool-invocation' */
  toolInvocation?: IToolInvocation
}

/** Structured content object returned by the messages endpoint */
export interface IRawMessageContent {
  format: number
  /** Pre-rendered plain-text string — use this for display */
  content: string
  parts: IRawMessagePart[]
  /** Top-level tool invocations parallel to parts */
  toolInvocations?: IToolInvocation[]
}

/** Raw Mastra message from GET /agents/:agentId/threads/:threadId */
export interface IRawThreadMessage {
  id?: string
  role: 'user' | 'assistant' | string
  /** Structured content object (format ≥ 2) or legacy plain string */
  content: IRawMessageContent | string
  createdAt?: string
  threadId?: string
  resourceId?: string
}

export interface IThreadMessagesPayload {
  messages: IRawThreadMessage[]
  total: number
  page: number
  perPage: number
  hasMore: boolean
}

// ============================================================================
// State
// ============================================================================

export interface IAIChatState {
  // ── Data ──────────────────────────────────────────────────────────────────
  agents: Record<string, IAgent>
  threads: IThread[]
  activeThread: IThread | null
  activeAgentId: string | null
  messages: IChatMessage[]

  // ── Status ────────────────────────────────────────────────────────────────
  isLoadingAgents: boolean
  isLoadingThreads: boolean
  isLoadingMessages: boolean
  isSending: boolean
  error: string | null

  // ── Chat modal visibility ─────────────────────────────────────────────────
  isChatOpen: boolean

  // ── Actions ───────────────────────────────────────────────────────────────
  fetchAgents: () => Promise<void>
  fetchThreads: () => Promise<void>
  loadThread: (agentId: string, threadId: string) => Promise<void>
  deleteThread: (agentId: string, threadId: string) => Promise<void>
  sendMessage: (content: string, attachedFiles?: string[]) => Promise<void>
  startNewThread: (agentId: string, content: string, attachedFiles?: string[]) => Promise<void>
  setActiveAgent: (agentId: string) => void
  clearError: () => void
  resetConversation: () => void
  openChat: () => void
  closeChat: () => void
}
