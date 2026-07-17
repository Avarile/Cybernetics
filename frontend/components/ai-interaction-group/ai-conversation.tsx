"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  AlertCircleIcon,
  BotIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { nanoid } from "nanoid"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chatbot/chain-of-thought"
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
} from "@/components/ai-elements/chatbot/confirmation"
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
} from "@/components/ai-elements/chatbot/inline-citation"
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/chatbot/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@/components/ai-elements/chatbot/message"
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/chatbot/model-selector"
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/chatbot/plan"
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/chatbot/prompt-input"
import {
  Queue,
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/chatbot/queue"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/chatbot/reasoning"

import {
  useAIActiveAgent,
  useAIActiveThread,
  useAIAgents,
  useAIChatStore,
  useAIError,
  useAIIsSending,
  useAIMessages,
  useAIThreads,
} from "@/lib/ai-chat-modal/ai-chat"
import type {
  IAgent,
  ICitationSource,
  IConfirmationHint,
  IThread,
  IUIHint,
} from "@/lib/interfaces/mastra.interface"
import { Shimmer } from "@/components/ai-elements/chatbot/shimmer"

// ============================================================================
// ThreadList
// ============================================================================

interface ThreadListProps {
  threads: IThread[]
  activeThreadId: string | null
  onSelect: (thread: IThread) => void
  onNewChat: () => void
  onDelete: (thread: IThread) => void
  isLoading: boolean
}

function ThreadList({
  threads,
  activeThreadId,
  onSelect,
  onNewChat,
  onDelete,
  isLoading,
}: ThreadListProps) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-medium">Conversations</span>
        <Button
          onClick={onNewChat}
          size="icon-sm"
          type="button"
          variant="ghost"
          aria-label="New conversation"
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <MessageSquareIcon className="size-8 opacity-40" />
            <p>No conversations yet.</p>
          </div>
        ) : (
          <ul className="space-y-0.5 p-2">
            {threads.map((thread) => (
              <li key={thread.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(thread)}
                  className={cn(
                    "w-full rounded-md px-3 py-2 pr-8 text-left text-sm transition-colors",
                    "hover:bg-accent hover:text-accent-foreground",
                    activeThreadId === thread.id &&
                      "bg-accent font-medium text-accent-foreground"
                  )}
                >
                  <span className="line-clamp-2 leading-snug">
                    {thread.title ?? "Untitled conversation"}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {new Date(thread.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(thread) }}
                  aria-label="Delete conversation"
                  className={cn(
                    "absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1",
                    "text-muted-foreground opacity-0 transition-opacity",
                    "hover:text-destructive group-hover:opacity-100",
                  )}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </aside>
  )
}

// ============================================================================
// AttachedFilesList — rendered inside PromptInput context
// ============================================================================

function AttachedFilesList() {
  const { files, remove } = usePromptInputAttachments()
  if (files.length === 0) return null
  return (
    <PromptInputHeader>
      <div className="flex flex-wrap gap-1.5 px-1 pt-1">
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-1 rounded-md border bg-muted/60 px-2 py-0.5 text-xs"
          >
            <PaperclipIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="max-w-[120px] truncate">{f.filename}</span>
            <button
              type="button"
              onClick={() => remove(f.id)}
              aria-label={`Remove ${f.filename}`}
              className="ml-0.5 rounded text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </PromptInputHeader>
  )
}

// ============================================================================
// AgentPicker — inside PromptInputFooter using ModelSelector
// ============================================================================

interface AgentPickerProps {
  agents: Record<string, IAgent>
  activeAgentId: string | null
  onSelect: (agentId: string) => void
  isLoading: boolean
}

function AgentPicker({
  agents,
  activeAgentId,
  onSelect,
  isLoading,
}: AgentPickerProps) {
  const [open, setOpen] = useState(false)
  const agentList = Object.values(agents)
  const active = activeAgentId ? agents[activeAgentId] : null

  return (
    <ModelSelector open={open} onOpenChange={setOpen}>
      <ModelSelectorTrigger asChild>
        <PromptInputButton
          disabled={isLoading || agentList.length === 0}
          tooltip="Select agent"
          className="gap-1.5"
        >
          <BotIcon className="size-4" />
          <span className="max-w-[120px] truncate">
            <Shimmer duration={4}>{active?.name ?? "Select agent"}</Shimmer>
          </span>
        </PromptInputButton>
      </ModelSelectorTrigger>
      <ModelSelectorContent title="Select Agent">
        <ModelSelectorInput placeholder="Search agents…" />
        <ModelSelectorList>
          <ModelSelectorEmpty>No agents found</ModelSelectorEmpty>
          <ModelSelectorGroup>
            {agentList.map((agent) => (
              <ModelSelectorItem
                key={agent.id}
                value={agent.id}
                onSelect={() => {
                  onSelect(agent.id)
                  setOpen(false)
                }}
                className={cn(activeAgentId === agent.id && "font-medium")}
              >
                <ModelSelectorName>{agent.name}</ModelSelectorName>
              </ModelSelectorItem>
            ))}
          </ModelSelectorGroup>
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  )
}

// ============================================================================
// UIHintRenderer — dispatches to the correct chatbot component per hint type
// ============================================================================

interface UIHintRendererProps {
  hint: IUIHint
  onAction: (text: string) => void
}

function UIHintRenderer({ hint, onAction }: UIHintRendererProps) {
  // Stable id for Confirmation approval object (stays constant for the
  // lifetime of the message, not recreated on every render)
  const confirmationId = useRef(nanoid()).current

  switch (hint.type) {
    case "reasoning":
      return (
        <Reasoning defaultOpen={false} className="mb-2">
          <ReasoningTrigger />
          <ReasoningContent>{hint.content}</ReasoningContent>
        </Reasoning>
      )

    case "chain_of_thought":
      return (
        <ChainOfThought className="mb-2">
          <ChainOfThoughtHeader />
          <ChainOfThoughtContent>
            {hint.steps.map((step, i) => (
              <ChainOfThoughtStep
                key={i}
                label={step.label}
                description={step.description}
                status={step.status ?? "complete"}
              />
            ))}
          </ChainOfThoughtContent>
        </ChainOfThought>
      )

    case "plan":
      return (
        <Plan defaultOpen className="mb-2">
          <PlanHeader>
            <div className="flex-1">
              <PlanTitle>{hint.title}</PlanTitle>
              {hint.description && (
                <PlanDescription>{hint.description}</PlanDescription>
              )}
            </div>
            <PlanAction>
              <PlanTrigger />
            </PlanAction>
          </PlanHeader>
          <PlanContent>
            <Queue>
              <QueueSection defaultOpen>
                <QueueList>
                  {hint.steps.map((step, i) => (
                    <QueueItem key={i}>
                      <div className="flex items-start gap-2">
                        <QueueItemIndicator
                          completed={step.status === "complete"}
                        />
                        <QueueItemContent
                          completed={step.status === "complete"}
                        >
                          {step.label}
                        </QueueItemContent>
                      </div>
                    </QueueItem>
                  ))}
                </QueueList>
              </QueueSection>
            </Queue>
          </PlanContent>
        </Plan>
      )

    case "queue":
      return (
        <Queue className="mb-2">
          <QueueSection defaultOpen>
            <QueueSectionTrigger>
              <QueueSectionLabel
                count={hint.items.length}
                label={hint.title ?? "tasks"}
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                {hint.items.map((item) => (
                  <QueueItem key={item.id}>
                    <div className="flex items-start gap-2">
                      <QueueItemIndicator completed={item.completed} />
                      <div className="flex-1">
                        <QueueItemContent completed={item.completed}>
                          {item.title}
                        </QueueItemContent>
                        {item.description && (
                          <QueueItemDescription completed={item.completed}>
                            {item.description}
                          </QueueItemDescription>
                        )}
                      </div>
                    </div>
                  </QueueItem>
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        </Queue>
      )

    case "suggestions":
      return (
        <div className="flex flex-wrap gap-2 pt-1">
          {hint.items.map((suggestion, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAction(suggestion)}
              className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )

    case "confirmation": {
      const confirmationHint = hint as IConfirmationHint
      const approval =
        confirmationHint.state === "approval-requested"
          ? { id: confirmationId }
          : { id: confirmationId, approved: false as const }
      return (
        <Confirmation
          approval={approval}
          state={confirmationHint.state}
          className="mb-2"
        >
          <ConfirmationRequest>{confirmationHint.message}</ConfirmationRequest>
          <ConfirmationActions>
            <ConfirmationAction
              variant="outline"
              onClick={() => onAction("No, please cancel.")}
            >
              Reject
            </ConfirmationAction>
            <ConfirmationAction
              onClick={() => onAction("Yes, please proceed.")}
            >
              Approve
            </ConfirmationAction>
          </ConfirmationActions>
        </Confirmation>
      )
    }

    default:
      return null
  }
}

// ============================================================================
// CitationList — renders web sources below a message
// ============================================================================

function CitationList({ sources }: { sources: ICitationSource[] }) {
  if (sources.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      {sources.map((source, i) => (
        <InlineCitation key={i}>
          <InlineCitationCard>
            <InlineCitationCardTrigger sources={[source.url]} />
            <InlineCitationCardBody>
              <div className="p-3">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium hover:underline"
                >
                  {source.title}
                </a>
                {source.description && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {source.description}
                  </p>
                )}
              </div>
            </InlineCitationCardBody>
          </InlineCitationCard>
        </InlineCitation>
      ))}
    </div>
  )
}

// ============================================================================
// ErrorBanner
// ============================================================================

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  return (
    <div className="flex items-start gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss error">
        <XIcon className="size-4" />
      </button>
    </div>
  )
}

// ============================================================================
// AIConversation — main export
// ============================================================================

export interface AIConversationProps {
  className?: string
}

export function AIConversation({ className }: AIConversationProps) {
  const {
    fetchAgents,
    fetchThreads,
    loadThread,
    deleteThread,
    sendMessage,
    startNewThread,
    setActiveAgent,
    resetConversation,
    clearError,
  } = useAIChatStore()

  const [pendingDelete, setPendingDelete] = useState<IThread | null>(null)

  const agents = useAIAgents()
  const threads = useAIThreads()
  const activeThread = useAIActiveThread()
  const activeAgentId = useAIActiveAgent()
  const messages = useAIMessages()
  const isSending = useAIIsSending()
  const error = useAIError()

  const isLoadingThreads = useAIChatStore((s) => s.isLoadingThreads)
  const isLoadingMessages = useAIChatStore((s) => s.isLoadingMessages)
  const isLoadingAgents = useAIChatStore((s) => s.isLoadingAgents)
  const firstAgentId = useAIChatStore((s) => Object.keys(s.agents)[0] ?? null)

  useEffect(() => {
    fetchAgents()
    fetchThreads()
  }, [fetchAgents, fetchThreads])

  const handleThreadSelect = useCallback(
    (thread: IThread) => {
      const agentId = thread.agentId ?? activeAgentId ?? firstAgentId
      if (!agentId) return
      loadThread(agentId, thread.id)
    },
    [loadThread, activeAgentId, firstAgentId]
  )

  const handleNewChat = useCallback(
    () => resetConversation(),
    [resetConversation]
  )

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDelete) return
    const agentId = pendingDelete.agentId ?? activeAgentId ?? firstAgentId ?? 'master-agent'
    await deleteThread(agentId, pendingDelete.id)
    setPendingDelete(null)
  }, [pendingDelete, activeAgentId, firstAgentId, deleteThread])

  // Read file blob URLs as text and inline into message content
  const handlePromptSubmit = useCallback(
    async ({ text, files }: PromptInputMessage) => {
      if (!activeAgentId) return

      let content = text
      const fileNames: string[] = []

      for (const file of files) {
        if (file.url) {
          try {
            const resp = await fetch(file.url)
            const fileText = await resp.text()
            content += `\n\n---\n[Attached: ${file.filename}]\n${fileText}`
            if (file.filename) fileNames.push(file.filename)
          } catch {
            // skip unreadable files silently
          }
        }
      }

      if (activeThread) {
        await sendMessage(content, fileNames.length > 0 ? fileNames : undefined)
      } else {
        await startNewThread(
          activeAgentId,
          content,
          fileNames.length > 0 ? fileNames : undefined
        )
      }
    },
    [activeAgentId, activeThread, sendMessage, startNewThread]
  )

  // Used by suggestion clicks and confirmation approve/reject buttons
  const handleQuickAction = useCallback(
    (text: string) => {
      if (!activeAgentId) return
      if (activeThread) {
        sendMessage(text)
      } else {
        startNewThread(activeAgentId, text)
      }
    },
    [activeAgentId, activeThread, sendMessage, startNewThread]
  )

  const canChat = !!activeAgentId

  return (
    <>
    <div className={cn("flex h-full overflow-hidden rounded-xs", className)}>
      {/* Sidebar */}
      <ThreadList
        threads={threads}
        activeThreadId={activeThread?.id ?? null}
        onSelect={handleThreadSelect}
        onNewChat={handleNewChat}
        onDelete={setPendingDelete}
        isLoading={isLoadingThreads}
      />

      {/* Main panel */}
      <div className="flex flex-1 flex-col overflow-hidden rounded-lg">
        {/* Header */}
        <header className="flex items-center px-4 py-2.5">
          {activeThread ? (
            <h2 className="truncate text-sm font-medium">
              {activeThread.title ?? "Conversation"}
            </h2>
          ) : (
            <h2 className="text-sm text-muted-foreground">New conversation</h2>
          )}
        </header>

        {/* Error banner */}
        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        {/* Messages */}
        <Conversation className="flex-1">
          <ConversationContent>
            {isLoadingMessages ? (
              <div className="space-y-4 p-4">
                <div className="h-12 w-3/4 animate-pulse rounded-lg bg-muted" />
                <div className="ml-auto h-10 w-1/2 animate-pulse rounded-lg bg-muted" />
                <div className="h-16 w-4/5 animate-pulse rounded-lg bg-muted" />
              </div>
            ) : messages.length === 0 ? (
              <ConversationEmptyState
                icon={<MessageSquareIcon className="size-10" />}
                title={canChat ? "Start a conversation" : "No agent selected"}
                description={
                  canChat
                    ? "Type a message or attach a .txt, .md, or .json file to begin."
                    : "Select an agent from the prompt bar below."
                }
              />
            ) : (
              messages.map((msg) => (
                <Message key={msg.id} from={msg.role}>
                  {/* UI hints rendered above message text */}
                  {msg.role === "assistant" && msg.ui && msg.ui.length > 0 && (
                    <div className="w-full space-y-1">
                      {msg.ui.map((hint, i) => (
                        <UIHintRenderer
                          key={i}
                          hint={hint}
                          onAction={handleQuickAction}
                        />
                      ))}
                    </div>
                  )}

                  {msg.content && (
                    <MessageContent>
                      {msg.role === "assistant" ? (
                        <MessageResponse>{msg.content}</MessageResponse>
                      ) : (
                        <span className="whitespace-pre-wrap">{msg.content}</span>
                      )}
                    </MessageContent>
                  )}

                  {/* Web citations below the message */}
                  {msg.role === "assistant" &&
                    msg.sources &&
                    msg.sources.length > 0 && (
                      <CitationList sources={msg.sources} />
                    )}

                  {msg.role === "user" &&
                    msg.attachedFiles &&
                    msg.attachedFiles.length > 0 && (
                      <MessageToolbar>
                        <div className="flex flex-wrap gap-1">
                          {msg.attachedFiles.map((name) => (
                            <span
                              key={name}
                              className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                            >
                              <PaperclipIcon className="size-3" />
                              {name}
                            </span>
                          ))}
                        </div>
                      </MessageToolbar>
                    )}
                </Message>
              ))
            )}

            {isSending && (
              <Message from="assistant">
                <MessageContent>
                  <div className="flex gap-1.5 py-1">
                    <span className="size-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:0ms]" />
                    <span className="size-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:150ms]" />
                    <span className="size-2 animate-bounce rounded-full bg-muted-foreground/40 [animation-delay:300ms]" />
                  </div>
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {/* Prompt input */}
        <PromptInput
          accept=".txt,.md,.json"
          multiple
          onSubmit={handlePromptSubmit}
          className="border-t bg-background px-3 pt-2 pb-3"
        >
          <AttachedFilesList />

          <PromptInputTextarea
            placeholder={
              canChat
                ? "Type a message… (Enter to send, Shift+Enter for newline)"
                : "Select an agent to start chatting"
            }
            disabled={!canChat || isSending}
          />

          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger tooltip="Attach file">
                  <PaperclipIcon className="size-4" />
                </PromptInputActionMenuTrigger>
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments label="Add file (.txt, .md, .json)" />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>

              <AgentPicker
                agents={agents}
                activeAgentId={activeAgentId}
                onSelect={setActiveAgent}
                isLoading={isLoadingAgents}
              />
            </PromptInputTools>

            <PromptInputTools>
              <PromptInputSubmit
                disabled={!canChat}
                status={isSending ? "submitted" : undefined}
              />
            </PromptInputTools>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>

    <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            &ldquo;{pendingDelete?.title ?? "Untitled conversation"}&rdquo; will be permanently
            deleted and cannot be recovered.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}
