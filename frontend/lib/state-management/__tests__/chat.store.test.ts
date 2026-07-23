import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '@/lib/state-management/chat.store'

beforeEach(() => useChatStore.setState({ activeConversationId: null, historyRailOpen: true }))

describe('chat.store', () => {
  it('sets the active conversation', () => {
    useChatStore.getState().setActiveConversation('c1')
    expect(useChatStore.getState().activeConversationId).toBe('c1')
    useChatStore.getState().setActiveConversation(null)
    expect(useChatStore.getState().activeConversationId).toBeNull()
  })
  it('toggles the history rail', () => {
    expect(useChatStore.getState().historyRailOpen).toBe(true)
    useChatStore.getState().toggleHistoryRail()
    expect(useChatStore.getState().historyRailOpen).toBe(false)
  })
})
