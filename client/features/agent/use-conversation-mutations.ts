"use client"

import { useCallback } from "react"
import { createAgentApi } from "@/lib/api/endpoints/agent"
import { scopes } from "@/lib/swr/keys"
import { useApi } from "@/lib/swr/provider"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { useTurnStore } from "@/stores/turn.store"
import type { ConversationStatus } from "@/lib/agent/types"

/**
 * Rename / archive / delete for one conversation.
 *
 * Each mutation revalidates the whole `["conversations"]` prefix rather than
 * patching a cache entry by hand: the rail's key carries its shelf and window
 * size, so a row that moves between shelves has to leave one entry and join
 * another, which a targeted write cannot express. Mirrors
 * `features/records/use-record-mutations.ts`.
 */
export function useConversationMutations() {
  const { client } = useApi()
  const invalidate = useInvalidate()
  const api = createAgentApi(client)

  const rename = useCallback(
    async (id: string, title: string) => {
      // Trim here so a whitespace-only rename reaches the API as an explicit
      // null — "clear the override" — rather than as a blank title.
      const next = title.trim()
      await api.renameConversation(id, next.length > 0 ? next : null)
      await invalidate(scopes.conversations())
    },
    [api, invalidate],
  )

  const setStatus = useCallback(
    async (id: string, status: ConversationStatus) => {
      await api.setConversationStatus(id, status)
      await invalidate(scopes.conversations())
    },
    [api, invalidate],
  )

  const remove = useCallback(
    async (id: string) => {
      await api.deleteConversation(id)
      // Deleting the conversation on screen leaves the terminal pointed at a
      // row that no longer exists; clear the selection before the rail refetches
      // so it lands on the empty state instead of a 404 transcript.
      if (useTurnStore.getState().activeId === id) {
        useTurnStore.getState().selectConversation(null)
      }
      await invalidate(scopes.conversations())
    },
    [api, invalidate],
  )

  return { rename, setStatus, remove }
}
