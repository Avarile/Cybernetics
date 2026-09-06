"use client"

import { selectPendingApproval, useTurnStore } from "@/stores/turn.store"

/**
 * The turn-store slice a terminal needs to render one conversation's live
 * state: which conversation is open, the turn being assembled from the
 * stream, and any approval it's currently paused on.
 */
export function useTurn() {
  const activeId = useTurnStore((s) => s.activeId)
  const turn = useTurnStore((s) => s.turn)
  const approval = useTurnStore(selectPendingApproval)
  return { activeId, turn, approval }
}
