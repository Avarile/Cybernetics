"use client"

import { useCallback, useState } from "react"
import useSWR from "swr"
import { keys } from "@/lib/swr/keys"
import { rowsOf, type Paginated } from "@/lib/api/types"
import type {
  AgentDescriptor,
  ConversationFilter,
  PublicConversation,
} from "@/lib/agent/types"

const PAGE_SIZE = 20
/**
 * `listConversationsSchema` caps `limit` at 100, so the rail can reach 100 rows
 * and no further. Beyond that a user would need search, which this iteration
 * deliberately does not have — `hasMore` goes false at the cap so the control
 * disappears rather than silently doing nothing.
 */
const MAX_ROWS = 100

/**
 * The rail's list: one shelf at a time, grown on demand.
 *
 * "Load more" raises `limit` on a single request rather than accumulating
 * separate page entries. That keeps the cache key an array — `hasPrefix`
 * rejects non-array keys, so `invalidate(scopes.conversations())` after a
 * rename or delete reaches this entry — and keeps the hook count fixed, which a
 * per-page `useSWR` loop would not. The cost is refetching rows already held,
 * bounded at 100 by the API's own page cap.
 */
export function useConversations(status: ConversationFilter = "active") {
  const [limit, setLimit] = useState(PAGE_SIZE)

  // Switching shelf resets the window: page depth on Active says nothing about
  // Archived, and carrying it over would fetch rows that are not there.
  const [shelf, setShelf] = useState(status)
  if (shelf !== status) {
    setShelf(status)
    setLimit(PAGE_SIZE)
  }
  const effectiveLimit = shelf === status ? limit : PAGE_SIZE

  const { data, error, isLoading } = useSWR<Paginated<PublicConversation>>(
    keys.conversations(1, effectiveLimit, status),
  )

  const conversations = rowsOf(data)
  const total = data?.total ?? 0

  const loadMore = useCallback(
    () => setLimit((n) => Math.min(n + PAGE_SIZE, MAX_ROWS)),
    [],
  )

  return {
    conversations,
    total,
    hasMore: conversations.length < Math.min(total, MAX_ROWS),
    loadMore,
    isLoading,
    error,
  }
}

/** The agent roster, for the picker. Static server-side, so it never revalidates. */
export function useAgents() {
  const { data, isLoading } = useSWR<AgentDescriptor[]>(keys.agents(), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  })
  // `Array.isArray`, not `?? []`: every other agent endpoint answers with a
  // `{ data, total }` envelope, so a proxy or a mis-stubbed test that returns one
  // here would hand the picker an object and crash it on `.find`. Falling back
  // to an empty roster degrades to a disabled picker instead.
  return { agents: Array.isArray(data) ? data : [], isLoading }
}
