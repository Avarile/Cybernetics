'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatStatus } from 'ai'
import { streamAgentChat } from '@/lib/services/agent-stream'
import type { ChatMessage, ChatPart, SseEvent, UiApproval } from '@/lib/interfaces/chat.interface'

let seq = 0
const nextId = () => `local-${Date.now()}-${seq++}`

interface Params {
  conversationId: string | null
  initialMessages: ChatMessage[]
  onConversationId?: (id: string) => void
}

/** Mutates the LAST assistant message in `list` via `fn`, returning a new array. */
function patchAssistant(list: ChatMessage[], fn: (parts: ChatPart[]) => ChatPart[]): ChatMessage[] {
  const idx = [...list].reverse().findIndex((m) => m.role === 'assistant')
  if (idx === -1) return list
  const realIdx = list.length - 1 - idx
  const next = list.slice()
  next[realIdx] = { ...next[realIdx], parts: fn(next[realIdx].parts.slice()) }
  return next
}

function upsertText(parts: ChatPart[], delta: string, kind: 'text' | 'reasoning'): ChatPart[] {
  const i = parts.findIndex((p) => p.type === kind)
  if (i === -1) return [...parts, { type: kind, text: delta }]
  const p = parts[i] as { type: 'text' | 'reasoning'; text: string }
  parts[i] = { ...p, text: p.text + delta }
  return parts
}

function upsertTool(parts: ChatPart[], toolCallId: string, patch: Partial<Extract<ChatPart, { type: 'tool' }>>): ChatPart[] {
  const i = parts.findIndex((p) => p.type === 'tool' && p.toolCallId === toolCallId)
  if (i === -1) return [...parts, { type: 'tool', toolCallId, toolName: '', state: 'input-available', ...patch }]
  parts[i] = { ...(parts[i] as object), ...patch } as ChatPart
  return parts
}

export function useAgentChat({ conversationId, initialMessages, onConversationId }: Params) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [status, setStatus] = useState<ChatStatus>('ready')
  const [pendingApproval, setPendingApproval] = useState<UiApproval | null>(null)
  const convRef = useRef<string | null>(conversationId)
  const seededRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  // Reset ONLY when the selected conversation switches to a different one than
  // the hook is tracking. A conversationId the stream itself just created equals
  // convRef.current, so this correctly does NOT wipe an in-progress new-chat stream.
  useEffect(() => {
    if (conversationId === convRef.current) return
    convRef.current = conversationId
    seededRef.current = false
    setMessages([])
    setStatus('ready')
    setPendingApproval(null)
  }, [conversationId])

  // Seed history once it arrives, unless we've already streamed/seeded.
  useEffect(() => {
    if (!seededRef.current && initialMessages.length > 0) {
      seededRef.current = true
      setMessages(initialMessages)
    }
  }, [initialMessages])

  const handleEvent = useCallback((e: SseEvent) => {
    switch (e.type) {
      case 'start':
        if (!convRef.current) { convRef.current = e.conversationId; onConversationId?.(e.conversationId) }
        setStatus('streaming')
        break
      case 'text-delta':
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, e.delta, 'text')))
        break
      case 'reasoning-delta':
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, e.delta, 'reasoning')))
        break
      case 'tool-input':
        setMessages((m) => patchAssistant(m, (p) => upsertTool(p, e.toolCallId, { toolName: e.toolName, state: 'input-available', input: e.args })))
        break
      case 'tool-output':
        setMessages((m) => patchAssistant(m, (p) => upsertTool(p, e.toolCallId, { toolName: e.toolName, state: e.isError ? 'output-error' : 'output-available', output: e.result, errorText: e.isError ? String((e.result as { message?: string })?.message ?? 'error') : undefined })))
        break
      case 'approval-required':
        setPendingApproval({ approvalId: e.approvalId, toolCallId: e.toolCallId, toolName: e.toolName, actionType: e.actionType, title: e.title, payload: e.payload })
        setMessages((m) => patchAssistant(m, (p) => upsertTool(p, e.toolCallId, { toolName: e.toolName, state: 'approval-requested' })))
        break
      case 'error':
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, `\n\n_Error: ${e.message}_`, 'text')))
        setStatus('error')
        break
      case 'done':
        setStatus('ready')
        break
    }
  }, [onConversationId])

  const run = useCallback(async (body: Parameters<typeof streamAgentChat>[0]) => {
    abortRef.current = new AbortController()
    setStatus('submitted')
    try {
      await streamAgentChat(body, { onEvent: handleEvent, signal: abortRef.current.signal })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((m) => patchAssistant(m, (p) => upsertText(p, `\n\n_Error: ${(err as Error).message}_`, 'text')))
        setStatus('error')
      } else {
        setStatus('ready')
      }
    }
  }, [handleEvent])

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || status === 'submitted' || status === 'streaming') return
    seededRef.current = true
    setMessages((m) => [
      ...m,
      { id: nextId(), role: 'user', parts: [{ type: 'text', text: trimmed }] },
      { id: nextId(), role: 'assistant', parts: [] },
    ])
    await run({ conversationId: convRef.current ?? undefined, message: trimmed })
  }, [run, status])

  const respondApproval = useCallback(async (approved: boolean) => {
    const appr = pendingApproval
    if (!appr) return
    setPendingApproval(null)
    setMessages((m) => patchAssistant(m, (p) => upsertTool(p, appr.toolCallId, { state: 'approval-responded' })))
    await run({ conversationId: convRef.current ?? undefined, resume: { approvalId: appr.approvalId, approved } })
  }, [pendingApproval, run])

  const stop = useCallback(() => { abortRef.current?.abort(); setStatus('ready') }, [])

  return { messages, status, pendingApproval, sendMessage, stop, respondApproval }
}
