"use client"

import { useState, type ReactNode } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useRecordWindows } from "@/features/records/use-record-windows"
import { DataTable } from "./data-table"
import type { RecordRelationSpec } from "./record-form-spec"
import type { DomainTableConfig, HasId } from "./types"

/**
 * A record's fields plus its per-record collections, as tabs.
 *
 * Only the active tab is mounted — keyed on the relation, so switching tabs
 * unmounts the previous table rather than leaving four of them subscribed.
 * Opening a contact would otherwise fire four requests for collections the
 * user may never look at.
 */
export function RecordTabs({
  recordId,
  relations,
  record,
  children,
}: {
  recordId: string
  relations: RecordRelationSpec[]
  /** The whole fetched response — where an inline relation's rows live. */
  record: Record<string, unknown>
  /** The Details pane. */
  children: ReactNode
}) {
  const [tab, setTab] = useState("details")
  const active = relations.find((r) => r.key === tab)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={tab} onValueChange={setTab} className="shrink-0 border-b border-border px-3 pb-2 pt-3">
        <TabsList className="h-8 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="details" className="text-xs">
            Details
          </TabsTrigger>
          {relations.map((r) => (
            <TabsTrigger key={r.key} value={r.key} className="text-xs">
              {r.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="min-h-0 flex-1 overflow-hidden">
        {active ? (
          <RelationTable
            key={active.key}
            config={active.config(recordId)}
            rows={active.rows?.(record)}
          />
        ) : (
          children
        )}
      </div>
    </div>
  )
}

function RelationTable<T extends HasId>({
  config,
  rows,
}: {
  config: DomainTableConfig<T>
  rows?: T[]
}) {
  const nav = useRecordWindows(config, (row) => String(row.id))
  return <DataTable config={config} rows={rows} {...nav} />
}
