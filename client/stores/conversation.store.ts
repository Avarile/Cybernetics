import { create } from "zustand"
import type { ChatMessageDto, PublicConversation } from "@/lib/agent/types"
import {
  initialTurn,
  markCancelled,
  markInterrupted,
  reduceTurn,
  turnToMessage,
  type TurnState,
} from "@/lib/agent/reducer"
import type { SseEvent } from "@/lib/agent/types"

export type LoadStatus = "idle" | "loading" | "ready" | "error"

interface ConversationStoreState {
  /** The conversation rail. */
  conversations: PublicConversation[]
  conversationsStatus: LoadStatus
  conversationsError: string | null

  /** null means an unsent new chat — the backend mints the id on `start`. */
  activeId: string | null

  /** Stored history for the active conversation. */
  messages: ChatMessageDto[]
  messagesStatus: LoadStatus
  messagesError: string | null

  /** The turn currently being assembled from the stream, if any. */
  turn: TurnState | null

  setConversations: (rows: PublicConversation[]) => void
  setConversationsStatus: (s: LoadStatus, error?: string) => void
  selectConversation: (id: string | null) => void
  setMessages: (rows: ChatMessageDto[]) => void
  setMessagesStatus: (s: LoadStatus, error?: string) => void

  /** Optimistically append the user's message before the stream opens. */
  appendUserMessage: (text: string) => void
  beginTurn: () => void
  applyEvent: (event: SseEvent) => void
  /** Folds a finished turn into `messages` and clears it. */
  settleTurn: (id: string, createdAt: string) => void
  cancelTurn: () => void
  interruptTurn: (reason?: string) => void
  clearTurn: () => void

  reset: () => void
}

export const useConversationStore = create<ConversationStoreState>((set, get) => ({
  conversations: [],
  conversationsStatus: "idle",
  conversationsError: null,

  activeId: null,

  messages: [],
  messagesStatus: "idle",
  messagesError: null,

  turn: null,

  setConversations: (conversations) =>
    set({ conversations, conversationsStatus: "ready", conversationsError: null }),

  setConversationsStatus: (conversationsStatus, conversationsError) =>
    set({ conversationsStatus, conversationsError: conversationsError ?? null }),

  selectConversation: (activeId) =>
    // Switching conversations drops the in-flight turn's UI state. The caller
    // is responsible for aborting its stream first.
    set({
      activeId,
      messages: [],
      messagesStatus: activeId ? "loading" : "idle",
      messagesError: null,
      turn: null,
    }),

  setMessages: (messages) =>
    set({ messages, messagesStatus: "ready", messagesError: null }),

  setMessagesStatus: (messagesStatus, messagesError) =>
    set({ messagesStatus, messagesError: messagesError ?? null }),

  appendUserMessage: (text) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          // Local id: the server assigns its own, and history is refetched on
          // the next load. Prefixed so it can never collide with a real uuid.
          id: `local-${s.messages.length}-${text.length}`,
          role: "user",
          createdAt: new Date().toISOString(),
          parts: [{ type: "text", text }],
        },
      ],
    })),

  beginTurn: () => set((s) => ({ turn: initialTurn(s.activeId) })),

  applyEvent: (event) =>
    set((s) => {
      if (!s.turn) return s
      const turn = reduceTurn(s.turn, event)
      // A first turn learns its conversation id from the `start` frame.
      const activeId = turn.conversationId ?? s.activeId
      return { turn, activeId }
    }),

  settleTurn: (id, createdAt) => {
    const { turn, messages } = get()
    if (!turn) return
    // A turn that produced nothing (an immediate error) leaves no message
    // behind — the error is surfaced by the composer instead.
    const next = turn.parts.length > 0 ? [...messages, turnToMessage(turn, id, createdAt)] : messages
    set({ messages: next, turn: null })
  },

  cancelTurn: () => set((s) => ({ turn: s.turn ? markCancelled(s.turn) : null })),

  interruptTurn: (reason) =>
    set((s) => ({ turn: s.turn ? markInterrupted(s.turn, reason) : null })),

  clearTurn: () => set({ turn: null }),

  reset: () =>
    set({
      conversations: [],
      conversationsStatus: "idle",
      conversationsError: null,
      activeId: null,
      messages: [],
      messagesStatus: "idle",
      messagesError: null,
      turn: null,
    }),
}))

/** The synthetic id the in-flight turn renders under. */
export const IN_FLIGHT_ID = "in-flight"

/**
 * Stored history plus the in-flight turn, as one list to render.
 *
 * NOT a zustand selector, deliberately. It builds a new message object each
 * call, so subscribing through it — even with `useShallow`, which compares
 * items by reference — fails the getSnapshot identity check and re-renders
 * forever. Subscribe to `messages` and `turn` separately and derive with
 * useMemo instead.
 */
export function buildVisibleMessages(
  messages: ChatMessageDto[],
  turn: TurnState | null,
): ChatMessageDto[] {
  if (!turn || turn.parts.length === 0) return messages
  return [
    ...messages,
    { id: IN_FLIGHT_ID, role: "assistant", createdAt: "", parts: turn.parts },
  ]
}

export const selectIsStreaming = (s: ConversationStoreState): boolean =>
  s.turn?.status === "streaming"

export const selectPendingApproval = (s: ConversationStoreState) => s.turn?.approval ?? null
