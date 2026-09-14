"use client"

import { useMemo } from "react"
import { ArrowRightIcon } from "lucide-react"
import { useRowAction } from "@/features/records/use-row-action"
import type { RowAction } from "@/components/data-table/types"
import type { Knowledge } from "./knowledge.config"

export type KnowledgeStatus = Knowledge["status"]

/**
 * The service's own transition table, mirrored.
 *
 * `knowledge.service.ts` declares, for each target status, which statuses it
 * may be reached FROM and what permission that needs:
 *
 *   draft:      from in_review | archived                 needs write
 *   in_review:  from draft                                needs write
 *   published:  from draft | in_review | archived         needs manage
 *   archived:   from draft | in_review | published        needs manage
 *   deprecated: from published | archived                 needs manage
 *
 * Mirrored here so the row menu offers only the moves this row can actually
 * make. A `status` select on the edit form would advertise all five and let
 * the server reject four of them — and worse, would suggest status is an
 * ordinary field that a PATCH can set, which it is not.
 */
export const KNOWLEDGE_TRANSITIONS: Record<
  KnowledgeStatus,
  { from: KnowledgeStatus[]; needs: Knowledge["access"][] }
> = {
  draft: { from: ["in_review", "archived"], needs: ["write", "manage"] },
  in_review: { from: ["draft"], needs: ["write", "manage"] },
  published: { from: ["draft", "in_review", "archived"], needs: ["manage"] },
  archived: { from: ["draft", "in_review", "published"], needs: ["manage"] },
  deprecated: { from: ["published", "archived"], needs: ["manage"] },
}

const LABELS: Record<KnowledgeStatus, string> = {
  draft: "Return to draft",
  in_review: "Send to review",
  published: "Publish",
  archived: "Archive",
  deprecated: "Deprecate",
}

/** The statuses this row may legally move to, for this principal. */
export function legalTransitions(row: Knowledge): KnowledgeStatus[] {
  return (Object.keys(KNOWLEDGE_TRANSITIONS) as KnowledgeStatus[]).filter((to) => {
    const rule = KNOWLEDGE_TRANSITIONS[to]
    return rule.from.includes(row.status) && rule.needs.includes(row.access)
  })
}

/**
 * Status moves as row actions.
 *
 * One action per target status, each hidden on rows the move is illegal for.
 * `visible` is evaluated per row by the table, which is exactly the
 * granularity the transition table needs — the same article is publishable
 * by its manager and not by its writer.
 */
export function useKnowledgeExtras() {
  const { run } = useRowAction("/knowledge")

  return useMemo(() => {
    const actions: RowAction<Knowledge>[] = (
      Object.keys(KNOWLEDGE_TRANSITIONS) as KnowledgeStatus[]
    ).map((to) => ({
      label: LABELS[to],
      icon: ArrowRightIcon,
      destructive: to === "deprecated",
      visible: (row) => legalTransitions(row).includes(to),
      onSelect: (row) =>
        void run(`/knowledge/${row.id}/status`, { status: to }, `${row.title} — ${LABELS[to]}`),
    }))
    return { rowActions: actions }
  }, [run])
}
