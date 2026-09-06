import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { initialTurn, markCancelled, markInterrupted, reduceTurn, type TurnState } from "@/lib/agent/reducer"
import type { ChatMessageDto, SseEvent } from "@/lib/agent/types"

interface TurnStoreState {
  /** null means an unsent new chat — the backend mints the id on `start`. */
  activeId: string | null
  /** The turn currently being assembled from the stream, if any. */
  turn: TurnState | null
  /** User messages sent this session that SWR has not refetched yet. */
  optimistic: ChatMessageDto[]
  /**
   * The stored transcript as it looked when the live turn began; null when no
   * turn is live. `useMessages` renders this instead of SWR's `data` for the
   * turn's duration — see the comment there for why the transcript is held
   * still at all.
   *
   * It lives in the store rather than in a ref inside `useMessages` because it
   * guards `turn` and `optimistic`, which are module-global and outlive any
   * component. A ref does not: minimising the terminal unmounts it
   * (`selectOpenWindows` filters minimised windows out of the layer), and
   * `useAgentChat`'s unmount cleanup aborts the stream, which cancels the turn
   * down the keep-state branch that never calls `settle()`. So the ref would
   * die with exactly the state it was protecting still in place, and the
   * remount would re-snapshot a history that by then contains the server's
   * copy of the user's message.
   */
  frozen: ChatMessageDto[] | null

  selectConversation: (id: string | null) => void
  appendOptimistic: (text: string) => void
  beginTurn: () => void
  applyEvent: (event: SseEvent) => void
  cancelTurn: () => void
  interruptTurn: (reason?: string) => void
  clearTurn: () => void
  /** Takes the snapshot `useMessages` renders for the turn's duration. */
  freezeTranscript: (stored: ChatMessageDto[]) => void
  /** Drops the finished turn and its optimistic rows, once SWR holds them. */
  settle: () => void
  reset: () => void
}

const EMPTY = {
  activeId: null,
  turn: null,
  optimistic: [] as ChatMessageDto[],
  frozen: null as ChatMessageDto[] | null,
}

/**
 * The client's half of a conversation.
 *
 * The rail and the stored history left for SWR — they are the server's truth and
 * they have cache keys. What stays is what only the client knows: which
 * conversation is open, the turn being assembled from the stream, and user
 * messages shown before a refetch has caught up.
 */
export const useTurnStore = create<TurnStoreState>()(
  immer((set) => ({
    ...EMPTY,

    // Switching conversations drops the in-flight turn's UI state. The caller is
    // responsible for aborting its stream first.
    selectConversation: (id) => set(() => ({ ...EMPTY, activeId: id })),

    appendOptimistic: (text) =>
      set((state) => {
        state.optimistic.push({
          // Local id: the server assigns its own, and history is refetched on
          // the next load. Prefixed so it can never collide with a real uuid.
          id: `local-${state.optimistic.length}-${text.length}`,
          role: "user",
          createdAt: new Date().toISOString(),
          parts: [{ type: "text", text }],
        })
      }),

    beginTurn: () =>
      set((state) => {
        state.turn = initialTurn(state.activeId)
      }),

    applyEvent: (event) =>
      set((state) => {
        if (!state.turn) return
        const next = reduceTurn(state.turn, event)
        state.turn = next
        // A first turn learns its conversation id from the `start` frame.
        if (next.conversationId) state.activeId = next.conversationId
      }),

    cancelTurn: () =>
      set((state) => {
        if (state.turn) state.turn = markCancelled(state.turn)
      }),

    interruptTurn: (reason) =>
      set((state) => {
        if (state.turn) state.turn = markInterrupted(state.turn, reason)
      }),

    clearTurn: () =>
      set((state) => {
        state.turn = null
      }),

    freezeTranscript: (stored) =>
      set((state) => {
        // Only the first call within a turn wins. The caller is an effect that
        // re-runs whenever `data` changes, and on a new conversation `data`
        // changes mid-turn — re-snapshotting then would capture the very
        // history the freeze exists to keep off screen.
        if (state.frozen === null) state.frozen = stored
      }),

    settle: () =>
      set((state) => {
        state.turn = null
        state.optimistic = []
        state.frozen = null
      }),

    reset: () => set(() => ({ ...EMPTY })),
  })),
)

export const selectPendingApproval = (s: TurnStoreState) => s.turn?.approval ?? null
