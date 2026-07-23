'use client'
import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'

interface ChatState {
  activeConversationId: string | null
  historyRailOpen: boolean
  setActiveConversation: (id: string | null) => void
  toggleHistoryRail: () => void
}

const creator: StateCreator<ChatState, [['zustand/devtools', never]], [], ChatState> = (set) => ({
  activeConversationId: null,
  historyRailOpen: true,
  setActiveConversation: (id) => set({ activeConversationId: id }, false, 'chat/setActiveConversation'),
  toggleHistoryRail: () => set((s) => ({ historyRailOpen: !s.historyRailOpen }), false, 'chat/toggleHistoryRail'),
})

export const useChatStore = create<ChatState>()(
  devtools(creator, { name: 'ChatStore', enabled: process.env.NODE_ENV === 'development' }),
)

// ── selectors ──────────────────────────────────────────────────────
export const useActiveConversationId = () => useChatStore((s) => s.activeConversationId)
export const useSetActiveConversation = () => useChatStore((s) => s.setActiveConversation)
export const useHistoryRailOpen = () => useChatStore((s) => s.historyRailOpen)
export const useToggleHistoryRail = () => useChatStore((s) => s.toggleHistoryRail)
