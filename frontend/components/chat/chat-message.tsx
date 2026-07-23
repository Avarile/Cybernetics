'use client'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/chatbot/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/chatbot/reasoning'
import { ChatToolPart } from '@/components/chat/chat-tool-part'
import { ChatApprovalCard } from '@/components/chat/chat-approval-card'
import type { ChatMessage as ChatMessageType, UiApproval } from '@/lib/interfaces/chat.interface'

interface Props {
  message: ChatMessageType
  isStreaming?: boolean
  pendingApproval?: UiApproval | null
  onRespondApproval?: (approved: boolean) => void
}

export function ChatMessage({ message, isStreaming, pendingApproval, onRespondApproval }: Props) {
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, i) => {
          switch (part.type) {
            case 'text':
              return <MessageResponse key={i} isAnimating={isStreaming}>{part.text}</MessageResponse>
            case 'reasoning':
              return (
                <Reasoning key={i} isStreaming={isStreaming}>
                  <ReasoningTrigger />
                  <ReasoningContent>{part.text}</ReasoningContent>
                </Reasoning>
              )
            case 'tool':
              return (
                <div key={i} className="space-y-2">
                  <ChatToolPart part={part} />
                  {pendingApproval && pendingApproval.toolCallId === part.toolCallId && onRespondApproval && (
                    <ChatApprovalCard approval={pendingApproval} onRespond={onRespondApproval} />
                  )}
                </div>
              )
            default:
              return null // 'source' rendered inline in a later phase
          }
        })}
      </MessageContent>
    </Message>
  )
}
