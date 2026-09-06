"use client"

import { useCallback, useEffect, useRef } from "react"
import { streamChat } from "@/lib/agent/stream"
import type { ChatStreamRequest } from "@/lib/agent/types"
import { ApiError } from "@/lib/api/errors"
import { createAgentApi } from "@/lib/api/endpoints/agent"
import { useApi } from "@/lib/api/provider"
import { rowsOf } from "@/lib/api/types"
import { useAuthStore } from "@/stores/auth.store"
import { useConversationStore } from "@/stores/conversation.store"

/**
 * Owns one conversation's lifecycle: history, the streaming turn, and
 * approvals.
 *
 * The multi-step flows live here rather than in components, so a view never
 * assembles "optimistic append → open stream → reconcile → refresh the rail".
 */
export function useAgentChat() {
  const { client } = useApi()
  const agent = useRef(createAgentApi(client))
  const abortRef = useRef<AbortController | null>(null)

  const store = useConversationStore

  // Abort any in-flight turn when the window unmounts, or the socket is left
  // open behind a closed terminal.
  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const loadConversations = useCallback(async () => {
    store.getState().setConversationsStatus("loading")
    try {
      const page = await agent.current.listConversations()
      store.getState().setConversations(rowsOf(page))
    } catch (err) {
      store
        .getState()
        .setConversationsStatus(
          "error",
          err instanceof ApiError ? err.message : "Could not load conversations",
        )
    }
  }, [store])

  const openConversation = useCallback(
    async (id: string | null) => {
      // Switching away from a live turn must not leave its socket reading into
      // a store that has moved on.
      abortRef.current?.abort()
      store.getState().selectConversation(id)
      if (!id) return
      try {
        store.getState().setMessages(await agent.current.messages(id))
      } catch (err) {
        store
          .getState()
          .setMessagesStatus(
            "error",
            err instanceof ApiError ? err.message : "Could not load this conversation",
          )
      }
    },
    [store],
  )

  /** Shared by a new message and by resuming after an approval. */
  const runStream = useCallback(
    async (body: ChatStreamRequest) => {
      const controller = new AbortController()
      abortRef.current = controller
      store.getState().beginTurn()

      try {
        const result = await streamChat({
          baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000",
          getAccessToken: () => useAuthStore.getState().accessToken,
          body,
          signal: controller.signal,
          onEvent: (event) => store.getState().applyEvent(event),
        })

        if (result.aborted) {
          store.getState().cancelTurn()
        } else if (result.truncated) {
          store.getState().interruptTurn()
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "The agent could not be reached"
        // A pre-stream failure never produced a `done`, so mark it here.
        store.getState().applyEvent({ type: "error", message })
      } finally {
        if (abortRef.current === controller) abortRef.current = null

        const turn = store.getState().turn
        if (turn && turn.status !== "awaiting_approval") {
          store.getState().settleTurn(
            `assistant-${turn.runId ?? Date.now()}`,
            new Date().toISOString(),
          )
        }
        // The rail's titles and counts move with every turn.
        void loadConversations()
      }
    },
    [store, loadConversations],
  )

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      const conversationId = store.getState().activeId ?? undefined
      store.getState().appendUserMessage(trimmed)
      await runStream(
        conversationId ? { conversationId, message: trimmed } : { message: trimmed },
      )
    },
    [store, runStream],
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
      const conversationId = store.getState().activeId ?? undefined
      // The paused turn is replaced by the resumed one.
      store.getState().clearTurn()
      await runStream(
        conversationId
          ? { conversationId, resume: { approvalId, approved } }
          : { resume: { approvalId, approved } },
      )
    },
    [store, runStream],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { loadConversations, openConversation, sendMessage, decideApproval, stop }
}
