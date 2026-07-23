'use client'
import type { ChatStatus } from 'ai'
import { HugeiconsIcon } from '@hugeicons/react'
import { AiChat01Icon } from '@hugeicons/core-free-icons'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/chatbot/conversation'
import { ChatMessage } from '@/components/chat/chat-message'
import type { ChatMessage as ChatMessageType, UiApproval } from '@/lib/interfaces/chat.interface'

interface Props {
  messages: ChatMessageType[]
  status: ChatStatus
  pendingApproval: UiApproval | null
  onRespondApproval: (approved: boolean) => void
}

export function ChatThread({ messages, status, pendingApproval, onRespondApproval }: Props) {
  const lastId = messages[messages.length - 1]?.id
  return (
    <Conversation className="flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl">
        {messages.length === 0 ? (
          <ConversationEmptyState
            title="How can I help?"
            description="Ask a question, or reference your uploaded documents."
            icon={<HugeiconsIcon icon={AiChat01Icon} className="size-6" strokeWidth={2} />}
          />
        ) : (
          messages.map((m) => (
            <ChatMessage
              key={m.id}
              message={m}
              isStreaming={status === 'streaming' && m.id === lastId && m.role === 'assistant'}
              pendingApproval={m.role === 'assistant' ? pendingApproval : null}
              onRespondApproval={onRespondApproval}
            />
          ))
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
