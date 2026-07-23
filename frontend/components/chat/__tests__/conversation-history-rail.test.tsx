import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/lib/hooks/use-conversations', () => ({ useConversations: vi.fn() }))
import { useConversations } from '@/lib/hooks/use-conversations'
import { ConversationHistoryRail } from '@/components/chat/conversation-history-rail'

beforeEach(() => vi.clearAllMocks())
describe('ConversationHistoryRail', () => {
  it('lists conversations and highlights the active one', () => {
    vi.mocked(useConversations).mockReturnValue({ conversations: [{ id: 'c1', title: 'First', createdAt: '', updatedAt: '' }], total: 1, isLoading: false, error: undefined, mutate: vi.fn() } as never)
    render(<ConversationHistoryRail activeId="c1" onSelect={vi.fn()} />)
    expect(screen.getByRole('button', { name: /new chat/i })).toBeInTheDocument()
    expect(screen.getByText('First')).toBeInTheDocument()
  })
  it('starts a new chat', () => {
    vi.mocked(useConversations).mockReturnValue({ conversations: [], total: 0, isLoading: false, error: undefined, mutate: vi.fn() } as never)
    const onSelect = vi.fn()
    render(<ConversationHistoryRail activeId={null} onSelect={onSelect} />)
    screen.getByRole('button', { name: /new chat/i }).click()
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
