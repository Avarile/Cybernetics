import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }), usePathname: () => '/dashboard/chat', useSearchParams: () => new URLSearchParams() }))
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate: vi.fn() }) }))
vi.mock('@/lib/hooks/use-conversations', () => ({ useConversations: () => ({ conversations: [], isLoading: false }) }))
vi.mock('@/lib/hooks/use-conversation-messages', () => ({ useConversationMessages: () => ({ messages: [] }) }))
const sendMessage = vi.fn()
vi.mock('@/lib/hooks/use-agent-chat', () => ({
  useAgentChat: () => ({ messages: [], status: 'ready', pendingApproval: null, sendMessage, stop: vi.fn(), respondApproval: vi.fn() }),
}))

import { ChatView } from '@/components/chat/chat-view'
beforeEach(() => vi.clearAllMocks())

describe('ChatView', () => {
  it('renders the rail + thread + composer and sends a message', async () => {
    render(<ChatView />)
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
    expect(screen.getByText(/how can i help/i)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox'), 'hi')
    await userEvent.keyboard('{Enter}')
    expect(sendMessage).toHaveBeenCalledWith('hi')
  })
})
