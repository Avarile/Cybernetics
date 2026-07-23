import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChatThread } from '@/components/chat/chat-thread'

const noop = vi.fn()
describe('ChatThread', () => {
  it('shows the empty state with no messages', () => {
    render(<ChatThread messages={[]} status="ready" pendingApproval={null} onRespondApproval={noop} />)
    expect(screen.getByText(/how can i help/i)).toBeInTheDocument()
  })
  it('renders user + assistant messages', () => {
    render(
      <ChatThread
        status="ready" pendingApproval={null} onRespondApproval={noop}
        messages={[
          { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'ping' }] },
          { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'pong' }] },
        ]}
      />,
    )
    expect(screen.getByText('ping')).toBeInTheDocument()
    expect(screen.getByText('pong')).toBeInTheDocument()
  })
})
