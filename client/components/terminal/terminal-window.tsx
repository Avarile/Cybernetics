"use client"

import { useEffect, useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"
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
import { MESSAGE_MAX_LENGTH } from "@/lib/agent/types"
import {
  IN_FLIGHT_ID,
  buildVisibleMessages,
  selectPendingApproval,
  useConversationStore,
} from "@/stores/conversation.store"
import { ApprovalPanel } from "./approval-panel"
import { ConversationRail } from "./conversation-rail"
import { MessageParts } from "./message-parts"
import { useAgentChat } from "./use-agent-chat"

const SUGGESTIONS = [
  "What changed in the last 24 hours?",
  "Summarise my open tasks",
  "Find documents about Q3 revenue",
]

export function TerminalWindow() {
  const { loadConversations, openConversation, sendMessage, decideApproval, stop } =
    useAgentChat()

  const conversations = useConversationStore(useShallow((s) => s.conversations))
  const conversationsStatus = useConversationStore((s) => s.conversationsStatus)
  const conversationsError = useConversationStore((s) => s.conversationsError)
  const activeId = useConversationStore((s) => s.activeId)
  const messagesStatus = useConversationStore((s) => s.messagesStatus)
  const messagesError = useConversationStore((s) => s.messagesError)
  // Subscribed separately, then derived. buildVisibleMessages creates a new
  // message object for the in-flight turn, so subscribing *through* it would
  // fail zustand v5's getSnapshot identity check and re-render forever — even
  // wrapped in useShallow, which compares array items by reference.
  const storedMessages = useConversationStore(useShallow((s) => s.messages))
  const turn = useConversationStore((s) => s.turn)
  const messages = useMemo(
    () => buildVisibleMessages(storedMessages, turn),
    [storedMessages, turn],
  )
  const approval = useConversationStore(selectPendingApproval)

  const [deciding, setDeciding] = useState(false)

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

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
          status={conversationsStatus}
          error={conversationsError}
          activeId={activeId}
          onSelect={(id) => void openConversation(id)}
          onNew={() => void openConversation(null)}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Conversation className="min-h-0 flex-1">
          <ConversationContent className="gap-4">
            {messagesStatus === "loading" && (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}

            {messagesStatus === "error" && (
              <p role="alert" className="text-sm text-destructive">
                {messagesError ?? "Could not load this conversation"}
              </p>
            )}

            {messages.length === 0 && messagesStatus !== "loading" && (
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
