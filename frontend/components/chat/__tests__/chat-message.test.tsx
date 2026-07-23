import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatMessage } from '@/components/chat/chat-message'
import { normalizeToolState } from '@/components/chat/chat-tool-part'

describe('normalizeToolState', () => {
  it('maps v4 states to the v5 union', () => {
    expect(normalizeToolState('call')).toBe('input-available')
    expect(normalizeToolState('result')).toBe('output-available')
    expect(normalizeToolState('approval-requested')).toBe('approval-requested')
  })
})

describe('ChatMessage', () => {
  it('renders assistant text', () => {
    render(<ChatMessage message={{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Hello world' }] }} />)
    expect(screen.getByText(/Hello world/)).toBeInTheDocument()
  })
  it('renders an approval card for a pending tool and wires the buttons', () => {
    const onRespond = vi.fn()
    render(
      <ChatMessage
        message={{ id: 'm2', role: 'assistant', parts: [{ type: 'tool', toolCallId: 't1', toolName: 'send-email', state: 'approval-requested' }] }}
        pendingApproval={{ approvalId: 'a1', toolCallId: 't1', toolName: 'send-email', actionType: 'send_email', title: 'Approve send-email', payload: {} }}
        onRespondApproval={onRespond}
      />,
    )
    screen.getByRole('button', { name: /approve/i }).click()
    expect(onRespond).toHaveBeenCalledWith(true)
  })
})
