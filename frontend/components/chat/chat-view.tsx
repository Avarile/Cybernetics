'use client'
import { useSWRConfig } from 'swr'
import { useActiveConversationId, useSetActiveConversation } from '@/lib/state-management/chat.store'
import { useConversationMessages } from '@/lib/hooks/use-conversation-messages'
import { useAgentChat } from '@/lib/hooks/use-agent-chat'
import { useChatUrlSync } from '@/lib/hooks/use-chat-url-sync'
import { ConversationHistoryRail } from '@/components/chat/conversation-history-rail'
import { ChatThread } from '@/components/chat/chat-thread'
import { ChatComposer } from '@/components/chat/chat-composer'

/** Orchestrator: wires the history rail, streaming thread, and composer together. */
export function ChatView() {
  useChatUrlSync()
  const { mutate } = useSWRConfig()
  const activeConversationId = useActiveConversationId()
  const setActiveConversation = useSetActiveConversation()
  const { messages: history } = useConversationMessages(activeConversationId)

  const { messages, status, pendingApproval, sendMessage, stop, respondApproval } = useAgentChat({
    conversationId: activeConversationId,
    initialMessages: history,
    onConversationId: (id) => {
      setActiveConversation(id)
      void mutate((key) => Array.isArray(key) && key[0] === 'agent' && key[1] === 'conversations')
    },
  })

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] min-h-0">
      <ConversationHistoryRail activeId={activeConversationId} onSelect={setActiveConversation} />
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatThread messages={messages} status={status} pendingApproval={pendingApproval} onRespondApproval={respondApproval} />
        <div className="border-t p-3">
          <ChatComposer status={status} onSend={sendMessage} onStop={stop} conversationId={activeConversationId} />
        </div>
      </div>
    </div>
  )
}
