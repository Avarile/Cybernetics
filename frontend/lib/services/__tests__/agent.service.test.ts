import { describe, it, expect, beforeEach } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import { apiClient } from '@/lib/http/api-client'
import { agentService } from '@/lib/services/agent.service'

const mock = new MockAdapter(apiClient)
beforeEach(() => mock.reset())

describe('agentService', () => {
  it('chat posts to /agent/chat', async () => {
    mock.onPost('/agent/chat').reply(200, { conversationId: 'c1', runId: 'r1', text: 'hi', pendingApprovals: [] })
    const res = await agentService.chat({ message: 'hello' })
    expect(res.conversationId).toBe('c1')
    expect(res.text).toBe('hi')
  })
  it('listConversations passes pagination', async () => {
    mock.onGet('/agent/conversations').reply((config) => {
      expect(config.params).toEqual({ page: 2, limit: 10 })
      return [200, { data: [], total: 0, page: 2, limit: 10 }]
    })
    const res = await agentService.listConversations(2, 10)
    expect(res.page).toBe(2)
  })
  it('getMessages GETs the conversation thread', async () => {
    mock.onGet('/agent/conversations/c1/messages').reply(200, [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }])
    const res = await agentService.getMessages('c1')
    expect(res[0].parts[0]).toEqual({ type: 'text', text: 'hi' })
  })
})
