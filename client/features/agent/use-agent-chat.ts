"use client"

import { useCallback, useEffect, useRef } from "react"
import { useSWRConfig } from "swr"
import { streamChat } from "@/lib/agent/stream"
import type { ChatStreamRequest } from "@/lib/agent/types"
import { ApiError } from "@/lib/api/errors"
import { keys, scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { useSessionStore } from "@/stores/session.store"
import { useTurnStore } from "@/stores/turn.store"

/**
 * Owns one conversation's lifecycle: opening, streaming, and approvals.
 *
 * The multi-step flows live here rather than in components, so a view never
 * assembles "optimistic append → open stream → revalidate → refresh the rail".
 */
export function useAgentChat() {
  const { mutate } = useSWRConfig()
  const invalidate = useInvalidate()
  const abortRef = useRef<AbortController | null>(null)

  // Abort any in-flight turn when the window unmounts, so the socket is not
  // left open behind a closed terminal.
  useEffect(() => () => abortRef.current?.abort(), [])

  const openConversation = useCallback(
    async (id: string | null) => {
      // Switching away from a live turn must not leave its socket reading into
      // a store that has moved on.
      abortRef.current?.abort()
      useTurnStore.getState().selectConversation(id)
      if (id) await mutate(keys.messages(id))
    },
    [mutate],
  )

  /** Shared by a new message and by resuming after an approval. */
  const runStream = useCallback(
    async (body: ChatStreamRequest) => {
      const controller = new AbortController()
      abortRef.current = controller
      useTurnStore.getState().beginTurn()

      try {
        const result = await streamChat({
          baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
          getAccessToken: () => useSessionStore.getState().accessToken,
          body,
          signal: controller.signal,
          onEvent: (event) => useTurnStore.getState().applyEvent(event),
        })

        if (result.aborted) useTurnStore.getState().cancelTurn()
        else if (result.truncated) useTurnStore.getState().interruptTurn()
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "The agent could not be reached"
        // A pre-stream failure never produced a `done`, so mark it here.
        useTurnStore.getState().applyEvent({ type: "error", message })
      } finally {
        if (abortRef.current === controller) abortRef.current = null

        const { turn, activeId } = useTurnStore.getState()
        const status = turn?.status

        if (status && status !== "awaiting_approval") {
          if (status === "failed" || status === "interrupted" || status === "cancelled") {
            // Keep what is on screen — the turn's partial output and the
            // optimistic user message — and do NOT revalidate. An interrupted
            // turn's stream dropped but the server may well have finished the
            // run anyway, so refetching here can bring back a history that
            // already contains this exact turn, rendered a second time
            // *permanently* (unlike the settle-then-refetch race below, there
            // is no later revalidate to reconcile it away). And for `failed`,
            // whether the server persisted the user's message at all is
            // simply unknown, so clearing `optimistic` could make it
            // disappear for good. `reducer.ts`'s `markCancelled` is explicit
            // that partial output is kept for this exact reason.
          } else if (activeId) {
            // Revalidate first, settle second: clearing the turn before the
            // refetch lands would blink the assistant's reply off screen.
            await mutate(keys.messages(activeId))
            useTurnStore.getState().settle()
          }
        }

        // The rail's titles and counts move with every turn.
        await invalidate(scopes.conversations())
      }
    },
    [mutate, invalidate],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const conversationId = useTurnStore.getState().activeId ?? undefined
      useTurnStore.getState().appendOptimistic(trimmed)
      await runStream(conversationId ? { conversationId, message: trimmed } : { message: trimmed })
    },
    [runStream],
  )

  /**
   * Decides an approval and continues the same turn.
   *
   * This is the inline path — `POST /agent/chat/stream` with a `resume` body —
   * not `POST /agent/approvals/:id`. The two are not interchangeable: only this
   * one streams the rest of the turn back.
   */
  const decideApproval = useCallback(
    async (approvalId: string, approved: boolean) => {
      const conversationId = useTurnStore.getState().activeId ?? undefined
      // The paused turn is replaced by the resumed one.
      useTurnStore.getState().clearTurn()
      await runStream(
        conversationId
          ? { conversationId, resume: { approvalId, approved } }
          : { resume: { approvalId, approved } },
      )
    },
    [runStream],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { openConversation, sendMessage, decideApproval, stop }
}
