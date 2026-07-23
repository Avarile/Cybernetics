import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'

vi.mock('@/lib/services/agent.service', () => ({ agentService: { getMessages: vi.fn() } }))
import { agentService } from '@/lib/services/agent.service'
import { useConversationMessages } from '@/lib/hooks/use-conversation-messages'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
beforeEach(() => vi.clearAllMocks())

describe('useConversationMessages', () => {
  it('fetches a thread when an id is given', async () => {
    vi.mocked(agentService.getMessages).mockResolvedValue([{ id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'yo' }] }])
    const { result } = renderHook(() => useConversationMessages('c1'), { wrapper })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(agentService.getMessages).toHaveBeenCalledWith('c1')
  })

  it('does NOT fetch for a null id (new chat)', async () => {
    const { result } = renderHook(() => useConversationMessages(null), { wrapper })
    expect(result.current.messages).toEqual([])
    expect(agentService.getMessages).not.toHaveBeenCalled()
  })
})
