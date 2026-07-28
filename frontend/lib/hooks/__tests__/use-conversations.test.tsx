import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'

vi.mock('@/lib/services/agent.service', () => ({ agentService: { listConversations: vi.fn() } }))
import { agentService } from '@/lib/services/agent.service'
import { useConversations } from '@/lib/hooks/use-conversations'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)
beforeEach(() => vi.clearAllMocks())

const conv = (id: string, title: string | null = 'First') => ({
  id,
  title,
  kind: 'chat',
  status: 'active',
  lastMessageAt: '2026-07-28T00:30:30.095Z',
  messageCount: 2,
  createdAt: '2026-07-28T00:30:21.812Z',
  updatedAt: '2026-07-28T00:30:30.095Z',
})

describe('useConversations', () => {
  // Regression guard for the bug that emptied the chat history rail: the API
  // answered with a bare array while this hook reads the `{ data, total }`
  // envelope, so `conversations` was silently always []. Every hook consumer
  // mocked the hook itself, so nothing exercised the real payload shape.
  it('unwraps the paginated envelope the API returns', async () => {
    vi.mocked(agentService.listConversations).mockResolvedValue({
      data: [conv('c1'), conv('c2', 'Second')],
      total: 7,
      page: 1,
      limit: 30,
    } as never)

    const { result } = renderHook(() => useConversations(), { wrapper })

    await waitFor(() => expect(result.current.conversations).toHaveLength(2))
    expect(result.current.conversations.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(result.current.conversations[0].title).toBe('First')
    expect(result.current.total).toBe(7)
  })

  it('forwards page and limit to the service', async () => {
    vi.mocked(agentService.listConversations).mockResolvedValue({ data: [], total: 0, page: 2, limit: 30 } as never)
    renderHook(() => useConversations(2, 30), { wrapper })
    await waitFor(() => expect(agentService.listConversations).toHaveBeenCalledWith(2, 30))
  })

  it('reports an empty list rather than throwing when the payload has no data array', async () => {
    vi.mocked(agentService.listConversations).mockResolvedValue([] as never)
    const { result } = renderHook(() => useConversations(), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.conversations).toEqual([])
    expect(result.current.total).toBe(0)
  })

  it('surfaces a fetch error instead of hiding it behind an empty list', async () => {
    vi.mocked(agentService.listConversations).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useConversations(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.conversations).toEqual([])
  })
})
