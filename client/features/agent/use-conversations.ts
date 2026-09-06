"use client"

import useSWR from "swr"
import { keys } from "@/lib/swr/keys"
import { rowsOf, type Paginated } from "@/lib/api/types"
import type { PublicConversation } from "@/lib/agent/types"

export function useConversations() {
  // No options: the rail inherits SWR's `keepPreviousData: false`, which is the
  // safe default now that `provider.tsx` no longer turns it on app-wide.
  const { data, error, isLoading } = useSWR<Paginated<PublicConversation>>(keys.conversations())
  return { conversations: rowsOf(data), isLoading, error }
}
