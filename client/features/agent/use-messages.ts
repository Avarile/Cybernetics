"use client"

import { useEffect, useMemo } from "react"
import useSWR from "swr"
import { useShallow } from "zustand/react/shallow"
import { keys } from "@/lib/swr/keys"
import type { ChatMessageDto } from "@/lib/agent/types"
import { useTurnStore } from "@/stores/turn.store"

/** The synthetic id the in-flight turn renders under. */
export const IN_FLIGHT_ID = "in-flight"

/**
 * Stored history, plus what only the client knows about, as one list to render.
 *
 * The composition happens in a `useMemo` and never in a zustand selector: it
 * builds a new message object for the in-flight turn, so subscribing *through*
 * it would fail zustand v5's getSnapshot identity check and re-render forever —
 * even wrapped in `useShallow`, which compares array items by reference.
 */
export function useMessages() {
  const activeId = useTurnStore((s) => s.activeId)
  const optimistic = useTurnStore(useShallow((s) => s.optimistic))
  const turn = useTurnStore((s) => s.turn)
  const frozen = useTurnStore((s) => s.frozen)

  const { data, error, isLoading } = useSWR<ChatMessageDto[]>(
    activeId ? keys.messages(activeId) : null,
  )

  /**
   * While a turn is live the transcript is held still, and `turn.store`'s
   * `frozen` snapshot is rendered in place of SWR's `data`.
   *
   * A refetch must not reshape the transcript under a turn in flight. On a
   * brand-new conversation the SWR key materialises MID-stream — the `start`
   * frame is what reveals the conversation id — and that fetch comes back with
   * the user's message, which the server persisted the moment the request
   * arrived, while `optimistic` still holds the client's copy of it. Rendered
   * together that is the same message twice, and *permanently* so when the turn
   * ends failed/interrupted/cancelled: those branches deliberately skip
   * `settle()` (use-agent-chat.ts), so nothing ever clears `optimistic` again.
   *
   * Freezing closes the overlap window instead of trying to tell a server echo
   * from a genuinely repeated message by its text, which cannot be done:
   * sending never refetches, so `stored` is stale on an existing conversation,
   * and "the user said the same thing twice" would be hidden as an echo.
   *
   * `live` includes `optimistic` and not just `turn` as defence against a
   * future refactor: `decideApproval` clears the turn immediately before the
   * resumed one begins, and if a yield were ever introduced between those two
   * calls a render could land in the gap and re-snapshot. No render observes it
   * today — React reads zustand through `useSyncExternalStore`, which sees the
   * current value rather than a queued one — so this term is deliberately not
   * covered by a test.
   *
   * What the freeze swallows: while it holds, a revalidation of
   * `["conversation", id, "messages"]` lands in the SWR cache without being
   * rendered, which is the point. Focus revalidation is off (provider.tsx) and
   * nothing polls, but `revalidateOnReconnect` is SWR's default and is NOT
   * disabled, so a reconnect can refetch here; `invalidate(scopes.conversations())`
   * cannot, since it targets the rail's separate `["conversations"]` prefix.
   * The refetch is picked up when the freeze lifts. The case to watch is
   * `awaiting_approval`, which can park a turn non-null indefinitely — a
   * transcript changed by another client would not appear until the user
   * decides the approval.
   */
  const live = turn !== null || optimistic.length > 0

  useEffect(() => {
    if (live && frozen === null) useTurnStore.getState().freezeTranscript(data ?? [])
  }, [live, frozen, data])

  const messages = useMemo<ChatMessageDto[]>(() => {
    // `frozen ?? data ?? []`, not `frozen ?? []`: on the render where `live`
    // flips, the effect above has not run yet and blanking an existing
    // conversation's transcript for that one frame would be a visible flash.
    // Falling back to `data` renders exactly the value the effect is about to
    // freeze — `data` cannot move in between, because it only changes through a
    // React state update and React flushes pending passive effects before it
    // begins the render for one.
    const stored = live ? (frozen ?? data ?? []) : (data ?? [])
    const base = optimistic.length === 0 ? stored : [...stored, ...optimistic]
    if (!turn || turn.parts.length === 0) return base
    return [...base, { id: IN_FLIGHT_ID, role: "assistant", createdAt: "", parts: turn.parts }]
  }, [live, frozen, data, optimistic, turn])

  return { messages, isLoading: Boolean(activeId) && isLoading, error }
}
