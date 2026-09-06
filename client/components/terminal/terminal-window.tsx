"use client"

import { useState } from "react"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation"
import { Message, MessageContent } from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import { Suggestion } from "@/components/ai-elements/suggestion"
import { Skeleton } from "@/components/ui/skeleton"
import { useAgentChat } from "@/features/agent/use-agent-chat"
import { useConversations } from "@/features/agent/use-conversations"
import { IN_FLIGHT_ID, useMessages } from "@/features/agent/use-messages"
import { useTurn } from "@/features/agent/use-turn"
import { ApiError } from "@/lib/api/errors"
import { MESSAGE_MAX_LENGTH } from "@/lib/agent/types"
import { ApprovalPanel } from "./approval-panel"
import { ConversationRail } from "./conversation-rail"
import { MessageParts } from "./message-parts"

const SUGGESTIONS = [
  "What changed in the last 24 hours?",
  "Summarise my open tasks",
  "Find documents about Q3 revenue",
]

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

export function TerminalWindow() {
  const { openConversation, sendMessage, decideApproval, stop } = useAgentChat()

  const { conversations, isLoading: railLoading, error: railError } = useConversations()
  const { messages, isLoading: messagesLoading, error: messagesError } = useMessages()
  const { activeId, turn, approval } = useTurn()

  const [deciding, setDeciding] = useState(false)

  const streaming = turn?.status === "streaming"
  const status = streaming ? "streaming" : turn?.status === "failed" ? "error" : "ready"

  async function submit(message: PromptInputMessage) {
    const text = message.text.trim()
    if (!text || streaming) return
    await sendMessage(text)
  }

  async function decide(approved: boolean) {
    if (!approval) return
    setDeciding(true)
    try {
      await decideApproval(approval.approvalId, approved)
    } finally {
      setDeciding(false)
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden md:block">
        <ConversationRail
          conversations={conversations}
          status={railLoading ? "loading" : railError ? "error" : "ready"}
          error={railError ? errorMessage(railError, "Could not load conversations") : null}
          activeId={activeId}
          onSelect={(id) => void openConversation(id)}
          onNew={() => void openConversation(null)}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-4">
            {messagesLoading && (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}

            {messagesError && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(messagesError, "Could not load this conversation")}
              </p>
            )}

            {messages.length === 0 && !messagesLoading && (
              // `children` REPLACES the default title/description block rather
              // than sitting beside it, so the heading is rendered here too.
              <ConversationEmptyState>
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">Ask the system</h3>
                  <p className="text-sm text-muted-foreground">
                    It can search your knowledge base, read files, and act on your behalf.
                  </p>
                </div>
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <Suggestion key={s} suggestion={s} onClick={() => void sendMessage(s)} />
                  ))}
                </div>
              </ConversationEmptyState>
            )}

            {messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent>
                  <MessageParts
                    parts={m.parts}
                    streaming={streaming && m.id === IN_FLIGHT_ID}
                  />
                </MessageContent>
              </Message>
            ))}

            {approval && (
              <ApprovalPanel approval={approval} pending={deciding} onDecide={(a) => void decide(a)} />
            )}

            {turn?.status === "interrupted" && (
              <p role="alert" className="text-xs text-muted-foreground">
                {turn.error} The reply above may be incomplete.
              </p>
            )}
            {turn?.status === "failed" && turn.error && (
              <p role="alert" className="text-xs text-destructive">
                {turn.error}
              </p>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="shrink-0 border-t border-border p-3">
          <PromptInput onSubmit={submit}>
            <PromptInputBody>
              <PromptInputTextarea
                placeholder="Ask the system…"
                maxLength={MESSAGE_MAX_LENGTH}
                disabled={streaming}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <div className="ml-auto">
                <PromptInputSubmit status={status} onStop={stop} />
              </div>
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  )
}
