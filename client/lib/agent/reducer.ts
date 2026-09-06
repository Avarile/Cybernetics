import type {
  ActionType,
  ChatMessageDto,
  ChatMessagePart,
  DoneStatus,
  SseEvent,
} from "./types"

/**
 * A turn's lifecycle, as the UI needs to see it.
 *
 * `interrupted` has no backend equivalent — it is what the client records when
 * the socket dropped mid-stream and no `done` frame ever arrived. It is kept
 * distinct from `failed` so the UI can offer Retry for one and not the other.
 */
export type TurnStatus =
  | "idle"
  | "streaming"
  | "succeeded"
  | "awaiting_approval"
  | "cancelled"
  | "failed"
  | "interrupted"

export interface PendingApproval {
  approvalId: string
  toolCallId: string
  toolName: string
  actionType: ActionType
  title: string
  payload: Record<string, unknown>
}

/** An assistant turn being assembled from the stream. */
export interface TurnState {
  conversationId: string | null
  runId: string | null
  status: TurnStatus
  parts: ChatMessagePart[]
  /** Set by an `error` frame, or by the transport on a drop. */
  error: string | null
  /** Populated by `approval-required`; the turn pauses until it is decided. */
  approval: PendingApproval | null
}

export function initialTurn(conversationId: string | null = null): TurnState {
  return {
    conversationId,
    runId: null,
    status: "idle",
    parts: [],
    error: null,
    approval: null,
  }
}

/** The trailing part, only if it is still the open one of that kind. */
function openPart(parts: ChatMessagePart[], kind: "text" | "reasoning") {
  const last = parts[parts.length - 1]
  return last?.type === kind ? last : null
}

/**
 * Appends a delta to the open text/reasoning part, opening one if the previous
 * part was of another kind.
 *
 * Opening a new part on a kind switch is what makes interleaved reasoning and
 * text render as separate blocks rather than one run-on paragraph.
 */
function appendDelta(
  parts: ChatMessagePart[],
  kind: "text" | "reasoning",
  delta: string,
): ChatMessagePart[] {
  const open = openPart(parts, kind)
  if (open) {
    const next = parts.slice(0, -1)
    next.push({ ...open, text: open.text + delta })
    return next
  }
  return [...parts, { type: kind, text: delta }]
}

/**
 * The whole stream contract in one pure function.
 *
 * Kept free of network, store and React so the tricky orderings — a tool
 * resolving after a text block, an approval mid-turn, a delta arriving after
 * `done` — can be tested as data.
 */
export function reduceTurn(state: TurnState, event: SseEvent): TurnState {
  switch (event.type) {
    case "start":
      // A first turn has no conversation id until the backend mints one.
      return {
        ...state,
        conversationId: event.conversationId,
        runId: event.runId,
        status: "streaming",
        error: null,
      }

    case "text-delta":
      return {
        ...state,
        status: "streaming",
        parts: appendDelta(state.parts, "text", event.delta),
      }

    case "reasoning-delta":
      return {
        ...state,
        status: "streaming",
        parts: appendDelta(state.parts, "reasoning", event.delta),
      }

    case "tool-input":
      return {
        ...state,
        status: "streaming",
        parts: [
          ...state.parts,
          {
            type: "tool",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            state: "input-available",
            input: event.args,
          },
        ],
      }

    case "tool-output": {
      // Resolved by toolCallId, not by position: tool calls can overlap, and
      // the matching input may not be the most recent part.
      const idx = state.parts.findIndex(
        (p) => p.type === "tool" && p.toolCallId === event.toolCallId,
      )
      const resolved: ChatMessagePart = {
        type: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        state: event.isError ? "output-error" : "output-available",
        input: idx >= 0 ? (state.parts[idx] as { input?: unknown }).input : undefined,
        output: event.result,
        errorText: event.isError ? String(event.result ?? "tool failed") : undefined,
      }
      // An output with no matching input still renders, rather than vanishing.
      const parts =
        idx >= 0
          ? state.parts.map((p, i) => (i === idx ? resolved : p))
          : [...state.parts, resolved]
      return { ...state, status: "streaming", parts }
    }

    case "approval-required":
      return {
        ...state,
        status: "streaming",
        approval: {
          approvalId: event.approvalId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          actionType: event.actionType,
          title: event.title,
          payload: event.payload,
        },
      }

    case "error":
      return { ...state, status: "failed", error: event.message }

    case "done":
      return { ...state, status: doneToStatus(event.status) }

    default:
      // A variant a newer backend added. Ignored rather than fatal — the
      // parser already let it through for exactly this reason.
      return state
  }
}

function doneToStatus(status: DoneStatus): TurnStatus {
  return status
}

/** Applies a whole stream in order. Convenience for tests and replay. */
export function reduceAll(state: TurnState, events: SseEvent[]): TurnState {
  return events.reduce(reduceTurn, state)
}

/** Marks a turn whose stream ended without a `done` frame. */
export function markInterrupted(state: TurnState, reason?: string): TurnState {
  if (state.status !== "streaming") return state
  return { ...state, status: "interrupted", error: reason ?? "The stream ended unexpectedly" }
}

/** Marks a turn the user stopped. Partial output is deliberately kept. */
export function markCancelled(state: TurnState): TurnState {
  return { ...state, status: "cancelled" }
}

/** A finished turn as a stored-history message, so live and replayed
 *  conversations render through one path. */
export function turnToMessage(state: TurnState, id: string, createdAt: string): ChatMessageDto {
  return { id, role: "assistant", createdAt, parts: state.parts }
}
