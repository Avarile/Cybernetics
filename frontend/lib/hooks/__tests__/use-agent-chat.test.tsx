import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ChatMessage, SseEvent } from '@/lib/interfaces/chat.interface'

const streamAgentChat = vi.fn()
vi.mock('@/lib/services/agent-stream', () => ({ streamAgentChat: (...a: unknown[]) => streamAgentChat(...a) }))
import { useAgentChat } from '@/lib/hooks/use-agent-chat'

// Helper: a streamAgentChat mock that emits a scripted list of events.
function emits(events: SseEvent[]) {
  return vi.fn(async (_body: unknown, opts: { onEvent: (e: SseEvent) => void }) => {
    for (const e of events) opts.onEvent(e)
  })
}
beforeEach(() => vi.clearAllMocks())

describe('useAgentChat', () => {
  it('appends the user message, streams assistant text, and ends ready', async () => {
    streamAgentChat.mockImplementation(emits([
      { type: 'start', conversationId: 'c1', runId: 'r1' },
      { type: 'text-delta', delta: 'Hel' },
      { type: 'text-delta', delta: 'lo' },
      { type: 'done', status: 'succeeded' },
    ]))
    const onConversationId = vi.fn()
    const { result } = renderHook(() => useAgentChat({ conversationId: null, initialMessages: [], onConversationId }))
    await act(async () => { await result.current.sendMessage('hi') })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const roles = result.current.messages.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant'])
    const assistantText = result.current.messages[1].parts.find((p) => p.type === 'text')
    expect(assistantText).toEqual({ type: 'text', text: 'Hello' })
    expect(onConversationId).toHaveBeenCalledWith('c1')
  })

  it('surfaces a pending approval and clears it on respondApproval (stream resume)', async () => {
    streamAgentChat.mockImplementationOnce(emits([
      { type: 'start', conversationId: 'c1', runId: 'r1' },
      { type: 'tool-input', toolCallId: 't1', toolName: 'send-email', args: { to: 'x@y.z' } },
      { type: 'approval-required', approvalId: 'a1', toolCallId: 't1', toolName: 'send-email', actionType: 'send_email', title: 'Approve send-email', payload: {} },
      { type: 'done', status: 'awaiting_approval' },
    ]))
    const { result } = renderHook(() => useAgentChat({ conversationId: 'c1', initialMessages: [], onConversationId: vi.fn() }))
    await act(async () => { await result.current.sendMessage('email x') })
    await waitFor(() => expect(result.current.pendingApproval?.approvalId).toBe('a1'))

    streamAgentChat.mockImplementationOnce(emits([
      { type: 'text-delta', delta: 'sent!' },
      { type: 'tool-output', toolCallId: 't1', toolName: 'send-email', result: { ok: true }, isError: false },
      { type: 'done', status: 'succeeded' },
    ]))
    await act(async () => { await result.current.respondApproval(true) })
    await waitFor(() => expect(result.current.pendingApproval).toBeNull())
    expect(streamAgentChat.mock.calls[1][0]).toEqual({ conversationId: 'c1', resume: { approvalId: 'a1', approved: true } })
    expect(result.current.status).toBe('ready')
  })

  it('does not wipe a live stream when history arrives late for a just-created conversation', async () => {
    streamAgentChat.mockImplementationOnce(emits([
      { type: 'start', conversationId: 'c1', runId: 'r1' },
      { type: 'text-delta', delta: 'Hello' },
      { type: 'done', status: 'succeeded' },
    ]))
    const onConversationId = vi.fn()
    const { result, rerender } = renderHook(
      ({ conversationId, initialMessages }: { conversationId: string | null; initialMessages: ChatMessage[] }) =>
        useAgentChat({ conversationId, initialMessages, onConversationId }),
      { initialProps: { conversationId: null as string | null, initialMessages: [] as ChatMessage[] } },
    )

    await act(async () => { await result.current.sendMessage('hi') })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(onConversationId).toHaveBeenCalledWith('c1')

    // Simulate the SWR history fetch resolving late with a brand-new array reference
    // for the SAME conversationId the stream just created.
    const lateHistory: ChatMessage[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'Hello' }] },
    ]
    rerender({ conversationId: 'c1', initialMessages: lateHistory })

    const assistantText = result.current.messages
      .find((m) => m.role === 'assistant')
      ?.parts.find((p) => p.type === 'text')
    expect(assistantText).toEqual({ type: 'text', text: 'Hello' })
    expect(result.current.status).toBe('ready')
  })
})
