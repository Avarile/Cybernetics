'use client'

// Usage:
//   import { AIConversation } from "@/components/ai-conversation"
//
// <AIConversation className="h-[calc(100vh-4rem)]" />

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import { ApiError } from '@/lib/http/api-client'
import { mastraService } from '@/lib/services/mastra.service'
import type {
  IAIChatState,
  IAgent,
  IChatMessage,
  ICitationSource,
  IChainOfThoughtStep,
  IUIHint,
  IRawMessageContent,
  IRawMessagePart,
  IRawThreadMessage,
  IToolInvocation,
} from '@/lib/interfaces/mastra.interface'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a plain string from a Mastra message that may have structured content. */
function normaliseContent(raw: IRawThreadMessage['content']): string {
  if (typeof raw === 'string') return raw
  // Structured content object (format ≥ 2): use the pre-built plain-text field.
  // Fall back to joining only text-typed parts to exclude reasoning blocks.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (raw.content) return raw.content
    return raw.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text ?? '')
      .join('')
  }
  return ''
}

/**
 * Try to parse the agent's JSON envelope from a raw text string.
 * The agent is instructed to output:
 *   { "content": "...", "ui": [...], "sources": [...] }
 * Falls back to plain text if not valid JSON or missing the envelope shape.
 */
function parseAgentJSON(text: string): {
  content: string
  ui?: IUIHint[]
  sources?: ICitationSource[]
} {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed.content === 'string') {
        return {
          content: parsed.content,
          ui: Array.isArray(parsed.ui) ? (parsed.ui as IUIHint[]) : undefined,
          sources: Array.isArray(parsed.sources)
            ? (parsed.sources as ICitationSource[])
            : undefined,
        }
      }
    } catch {
      // Not valid JSON — treat as plain text
    }
  }
  return { content: text }
}

/**
 * Synthesise UI hints from raw Mastra message parts when `content` is empty.
 * - reasoning parts → IReasoningHint (joins all detail texts)
 * - tool-invocation parts → IChainOfThoughtHint (one step per tool call)
 */
function buildUIFromParts(
  parts: IRawMessagePart[],
  _toolInvocations?: IToolInvocation[],
): IUIHint[] {
  const hints: IUIHint[] = []

  // ── Reasoning ──────────────────────────────────────────────────────────────
  const reasoningParts = parts.filter((p) => p.type === 'reasoning')
  if (reasoningParts.length > 0) {
    const reasoningText = reasoningParts
      .map((p) => {
        if (p.details && p.details.length > 0) {
          return p.details
            .filter((d) => d.type === 'text')
            .map((d) => d.text)
            .join('')
        }
        return p.reasoning ?? ''
      })
      .filter(Boolean)
      .join('\n\n')

    if (reasoningText) {
      hints.push({ type: 'reasoning', content: reasoningText })
    }
  }

  // ── Tool invocations → chain of thought ────────────────────────────────────
  const toolParts = parts.filter(
    (p) => p.type === 'tool-invocation' && p.toolInvocation,
  )
  if (toolParts.length > 0) {
    const steps: IChainOfThoughtStep[] = toolParts.map((p) => {
      const inv = p.toolInvocation!
      return {
        label: inv.toolName,
        description: inv.state === 'result' ? 'Completed' : inv.state,
        status: inv.state === 'result' ? 'complete' : 'active',
      }
    })
    hints.push({ type: 'chain_of_thought', steps })
  }

  return hints
}

function normaliseMessages(raw: IRawThreadMessage[]): IChatMessage[] {
  return raw
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const rawText = normaliseContent(m.content)
      if (m.role === 'assistant') {
        if (rawText) {
          // Has text — try to parse the agent JSON envelope
          const { content, ui, sources } = parseAgentJSON(rawText)
          return {
            id: m.id ?? nanoid(),
            role: 'assistant' as const,
            content,
            timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
            ui,
            sources,
          }
        }

        // No text — synthesize UI hints from structured parts
        const structuredContent =
          typeof m.content === 'object' && m.content !== null && !Array.isArray(m.content)
            ? (m.content as IRawMessageContent)
            : null
        const partsUI = structuredContent
          ? buildUIFromParts(structuredContent.parts, structuredContent.toolInvocations)
          : []

        return {
          id: m.id ?? nanoid(),
          role: 'assistant' as const,
          content: '',
          timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
          ui: partsUI.length > 0 ? partsUI : undefined,
        }
      }
      return {
        id: m.id ?? nanoid(),
        role: 'user' as const,
        content: rawText,
        timestamp: m.createdAt ? new Date(m.createdAt) : new Date(),
      }
    })
    // Drop messages with nothing to display
    .filter((m) =>
      m.role === 'user'
        ? !!m.content
        : !!(m.content || (m.ui && m.ui.length > 0)),
    )
}

// ── Store creator ─────────────────────────────────────────────────────────────

const aiChatStoreCreator: StateCreator<
  IAIChatState,
  [['zustand/devtools', never]],
  [],
  IAIChatState
> = (set, get) => ({
  // ── Initial data ───────────────────────────────────────────────────────────
  agents: {},
  threads: [],
  activeThread: null,
  activeAgentId: null,
  messages: [],

  // ── Initial status ────────────────────────────────────────────────────────
  isLoadingAgents: false,
  isLoadingThreads: false,
  isLoadingMessages: false,
  isSending: false,
  error: null,

  // ── Modal state ───────────────────────────────────────────────────────────
  isChatOpen: false,

  // ── Actions ───────────────────────────────────────────────────────────────

  clearError: () => set({ error: null }, false, 'aiChat/clearError'),

  openChat: () => set({ isChatOpen: true }, false, 'aiChat/openChat'),
  closeChat: () => set({ isChatOpen: false }, false, 'aiChat/closeChat'),

  setActiveAgent: (agentId) => {
    const { activeAgentId, activeThread } = get()
    // Switching agent mid-conversation resets it to avoid cross-agent thread misuse.
    if (activeThread && agentId !== activeAgentId) {
      set(
        { activeAgentId: agentId, activeThread: null, messages: [] },
        false,
        'aiChat/setActiveAgent/reset',
      )
    } else {
      set({ activeAgentId: agentId }, false, 'aiChat/setActiveAgent')
    }
  },

  resetConversation: () =>
    set(
      { activeThread: null, messages: [] },
      false,
      'aiChat/resetConversation',
    ),

  fetchAgents: async () => {
    // Prevent concurrent duplicate calls
    if (get().isLoadingAgents) return
    set({ isLoadingAgents: true, error: null }, false, 'aiChat/fetchAgents/pending')
    try {
      const rawAgents = await mastraService.getAgents()
      // Mastra returns Record<agentId, { name, instructions, ... }> — the id is the key,
      // not a field inside the value. Normalize by injecting the key as `id`.
      const agents: Record<string, IAgent> = Object.fromEntries(
        Object.entries(rawAgents as Record<string, Omit<IAgent, 'id'>>).map(([key, val]) => [
          key,
          { ...val, id: key },
        ]),
      )
      const firstId = Object.keys(agents)[0] ?? null
      set(
        {
          agents,
          isLoadingAgents: false,
          activeAgentId: get().activeAgentId ?? firstId,
        },
        false,
        'aiChat/fetchAgents/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch agents'
      set({ error: message, isLoadingAgents: false }, false, 'aiChat/fetchAgents/rejected')
    }
  },

  fetchThreads: async () => {
    // Prevent concurrent duplicate calls
    if (get().isLoadingThreads) return
    set({ isLoadingThreads: true, error: null }, false, 'aiChat/fetchThreads/pending')
    try {
      const threads = await mastraService.getThreads()
      const sorted = [...threads].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      set({ threads: sorted, isLoadingThreads: false }, false, 'aiChat/fetchThreads/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch threads'
      set({ error: message, isLoadingThreads: false }, false, 'aiChat/fetchThreads/rejected')
    }
  },

  loadThread: async (agentId, threadId) => {
    set({ isLoadingMessages: true, error: null }, false, 'aiChat/loadThread/pending')
    try {
      const raw = await mastraService.getThreadMessages(agentId, threadId)
      const messages = normaliseMessages(raw)
      const thread = get().threads.find((t) => t.id === threadId) ?? null
      set(
        {
          messages,
          activeThread: thread,
          activeAgentId: agentId,
          isLoadingMessages: false,
        },
        false,
        'aiChat/loadThread/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load thread'
      set({ error: message, isLoadingMessages: false }, false, 'aiChat/loadThread/rejected')
    }
  },

  deleteThread: async (agentId, threadId) => {
    try {
      await mastraService.deleteThread(agentId, threadId)
      const { activeThread } = get()
      set(
        (s) => ({
          threads: s.threads.filter((t) => t.id !== threadId),
          // If the deleted thread was active, reset the conversation
          ...(activeThread?.id === threadId
            ? { activeThread: null, messages: [] }
            : {}),
        }),
        false,
        'aiChat/deleteThread/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete thread'
      set({ error: message }, false, 'aiChat/deleteThread/rejected')
    }
  },

  startNewThread: async (agentId, content, attachedFiles) => {
    set({ isSending: true, error: null }, false, 'aiChat/startNewThread/pending')

    const userMsg: IChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      timestamp: new Date(),
      attachedFiles,
    }
    set(
      (s) => ({ messages: [...s.messages, userMsg] }),
      false,
      'aiChat/startNewThread/userMsg',
    )

    try {
      // Use a proper UUID so Mastra can look up threads by ID correctly.
      const threadId = crypto.randomUUID()
      const { text, threadId: confirmedThreadId } = await mastraService.initiateSession(
        agentId,
        content,
        threadId,
      )

      const { content: assistantContent, ui, sources } = parseAgentJSON(text)
      // Skip storing an empty assistant message (backend returned no content)
      if (!assistantContent && !ui?.length) {
        set({ isSending: false }, false, 'aiChat/startNewThread/emptyResponse')
        return
      }
      const assistantMsg: IChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date(),
        ui,
        sources,
      }

      // Refresh thread list so new thread appears in sidebar
      const threads = await mastraService.getThreads().catch(() => get().threads)
      const sorted = [...threads].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      const newThread = sorted.find((t) => t.id === confirmedThreadId) ?? {
        id: confirmedThreadId,
        title: content.slice(0, 60),
        agentId,
        resourceId: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      set(
        (s) => ({
          messages: [...s.messages, assistantMsg],
          threads: sorted,
          activeThread: newThread,
          activeAgentId: agentId,
          isSending: false,
        }),
        false,
        'aiChat/startNewThread/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to send message'
      set({ error: message, isSending: false }, false, 'aiChat/startNewThread/rejected')
    }
  },

  sendMessage: async (content, attachedFiles) => {
    const { activeThread, activeAgentId } = get()
    if (!activeThread || !activeAgentId) return

    set({ isSending: true, error: null }, false, 'aiChat/sendMessage/pending')

    const userMsg: IChatMessage = {
      id: nanoid(),
      role: 'user',
      content,
      timestamp: new Date(),
      attachedFiles,
    }
    set(
      (s) => ({ messages: [...s.messages, userMsg] }),
      false,
      'aiChat/sendMessage/userMsg',
    )

    try {
      const { text } = await mastraService.continueSession(
        activeAgentId,
        activeThread.id,
        content,
      )

      const { content: assistantContent, ui, sources } = parseAgentJSON(text)
      // Skip storing an empty assistant message (backend returned no content)
      if (!assistantContent && !ui?.length) {
        set({ isSending: false }, false, 'aiChat/sendMessage/emptyResponse')
        return
      }
      const assistantMsg: IChatMessage = {
        id: nanoid(),
        role: 'assistant',
        content: assistantContent,
        timestamp: new Date(),
        ui,
        sources,
      }

      set(
        (s) => ({ messages: [...s.messages, assistantMsg], isSending: false }),
        false,
        'aiChat/sendMessage/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to send message'
      set({ error: message, isSending: false }, false, 'aiChat/sendMessage/rejected')
    }
  },
})

// ── Store instance ────────────────────────────────────────────────────────────

export const useAIChatStore = create<IAIChatState>()(
  devtools(aiChatStoreCreator, {
    name: 'AIChatStore',
    enabled: process.env.NODE_ENV === 'development',
  }),
)

// ── Selector hooks ────────────────────────────────────────────────────────────

export const useAIAgents        = () => useAIChatStore((s) => s.agents)
export const useAIThreads       = () => useAIChatStore((s) => s.threads)
export const useAIActiveThread  = () => useAIChatStore((s) => s.activeThread)
export const useAIActiveAgent   = () => useAIChatStore((s) => s.activeAgentId)
export const useAIMessages      = () => useAIChatStore((s) => s.messages)
export const useAIIsSending     = () => useAIChatStore((s) => s.isSending)
export const useAIError         = () => useAIChatStore((s) => s.error)
export const useAIIsLoading     = () =>
  useAIChatStore((s) => s.isLoadingAgents || s.isLoadingThreads || s.isLoadingMessages)
