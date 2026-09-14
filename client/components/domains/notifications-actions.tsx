"use client"

import { createContext, useContext, useMemo } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCellMutation } from "@/features/records/use-cell-mutation"
import { useLookup, type Lookup } from "@/features/records/use-lookup"
import { LookupCell } from "./cells"
import type { RowAction } from "@/components/data-table/types"
import type { Notification, NotificationPreference } from "./notifications.config"

const PREFERENCES_ENDPOINT = "/notifications/preferences"

const FREQUENCIES = [
  { value: "immediate", label: "Immediately" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "off", label: "Off" },
]

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: `${String(h).padStart(2, "0")}:00`,
}))

/**
 * One `useCellMutation` shared by every editable cell in the table.
 *
 * A hook per cell would give each row its own `saving`/`failed` sets and its
 * own snapshot of the cache, so two edits in flight would clobber one
 * another's rollback. Context is how a `cell()` callback — which cannot call
 * hooks itself — reaches a single instance.
 */
const PreferenceCtx = createContext<ReturnType<typeof useCellMutation<NotificationPreference>> | null>(
  null,
)

export function PreferenceProvider({ children }: { children: React.ReactNode }) {
  const mutation = useCellMutation<NotificationPreference>(PREFERENCES_ENDPOINT)
  return <PreferenceCtx.Provider value={mutation}>{children}</PreferenceCtx.Provider>
}

function usePreferenceWrite() {
  return useContext(PreferenceCtx)
}

/**
 * The whole preference, every time.
 *
 * `PUT /notifications/preferences` is an upsert keyed on `eventKey`, not a
 * PATCH of one field — sending only the changed field would reset the others
 * to their schema defaults.
 */
function writeBody(row: NotificationPreference, patch: Partial<NotificationPreference>) {
  const next = { ...row, ...patch }
  return {
    eventKey: next.eventKey,
    enabled: next.enabled,
    frequency: next.frequency,
    quietHoursStart: next.quietHoursStart,
    quietHoursEnd: next.quietHoursEnd,
  }
}

function useWritePreference() {
  const ctx = usePreferenceWrite()
  return (row: NotificationPreference, patch: Partial<NotificationPreference>) => {
    if (!ctx) return
    void ctx.write({
      rowKey: row.eventKey,
      method: "put",
      path: PREFERENCES_ENDPOINT,
      body: writeBody(row, patch),
      optimistic: (rows) =>
        rows.map((r) => (r.eventKey === row.eventKey ? { ...r, ...patch } : r)),
    })
  }
}

export function EnabledCell({ row }: { row: NotificationPreference }) {
  const write = useWritePreference()
  const ctx = usePreferenceWrite()
  const busy = ctx?.saving.has(row.eventKey) ?? false

  const control = (
    <Switch
      checked={row.isMandatory ? true : row.enabled}
      // Security and transactional mail is not opt-outable — the service
      // returns 403 for it. Rendering the switch enabled would offer an
      // action that can only ever fail, which is exactly what RowMenu
      // already refuses to do.
      disabled={row.isMandatory || busy}
      aria-label={`Enable ${row.name}`}
      onCheckedChange={(v) => write(row, { enabled: Boolean(v) })}
    />
  )

  if (!row.isMandatory) return control
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{control}</span>
      </TooltipTrigger>
      <TooltipContent>
        Required — security and transactional mail cannot be turned off.
      </TooltipContent>
    </Tooltip>
  )
}

export function FrequencyCell({ row }: { row: NotificationPreference }) {
  const write = useWritePreference()
  const ctx = usePreferenceWrite()
  const busy = ctx?.saving.has(row.eventKey) ?? false

  return (
    <Select
      value={row.frequency}
      disabled={busy}
      onValueChange={(v) => write(row, { frequency: v as NotificationPreference["frequency"] })}
    >
      <SelectTrigger size="sm" className="h-7 w-32 text-xs" aria-label={`Frequency for ${row.name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FREQUENCIES.map((f) => (
          <SelectItem key={f.value} value={f.value}>
            {f.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const ANY = "__none"

export function QuietHoursCell({ row }: { row: NotificationPreference }) {
  const write = useWritePreference()
  const ctx = usePreferenceWrite()
  const busy = ctx?.saving.has(row.eventKey) ?? false
  const failure = ctx?.failed.get(row.eventKey)

  const hour = (v: number | null) => (v == null ? ANY : String(v))
  const parse = (v: string) => (v === ANY ? null : Number(v))

  return (
    <span className="flex items-center gap-1">
      <Select
        value={hour(row.quietHoursStart)}
        disabled={busy}
        onValueChange={(v) => write(row, { quietHoursStart: parse(v) })}
      >
        <SelectTrigger size="sm" className="h-7 w-20 text-xs" aria-label={`Quiet from, ${row.name}`}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>—</SelectItem>
          {HOURS.map((h) => (
            <SelectItem key={h.value} value={h.value}>
              {h.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">to</span>
      <Select
        value={hour(row.quietHoursEnd)}
        disabled={busy}
        onValueChange={(v) => write(row, { quietHoursEnd: parse(v) })}
      >
        <SelectTrigger size="sm" className="h-7 w-20 text-xs" aria-label={`Quiet until, ${row.name}`}>
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>—</SelectItem>
          {HOURS.map((h) => (
            <SelectItem key={h.value} value={h.value}>
              {h.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* A failed row stays marked. Snapping the control back with no
          explanation reads as "the setting didn't stick". */}
      {failure && <span className="text-xs text-destructive">!</span>}
    </span>
  )
}

/**
 * The event-type lookup, resolved once for the whole suppressions table.
 *
 * Same reasoning as FinanceLookupProvider: `SuppressionEvent` used to call
 * `useLookup` — and so `useSWR` — per cell, which is one subscription and one
 * rebuilt id→label Map per row, re-established on every render of the table.
 */
const EventCtx = createContext<Lookup | null>(null)

export function SuppressionLookupProvider({ children }: { children: React.ReactNode }) {
  const events = useLookup("/system/notifications/event-types", "name")
  return <EventCtx.Provider value={events}>{children}</EventCtx.Provider>
}

/**
 * A suppression's event, resolved from its id.
 *
 * The row carries `eventTypeId` and no key — verified live; the column
 * rendered an em dash for every row before this.
 *
 * A null id is not a missing label: the API uses it for a blanket suppression,
 * so it reads "All events" rather than going through the lookup at all.
 */
export function SuppressionEvent({ id }: { id: string | null }) {
  const events = useContext(EventCtx)
  if (!id) return <span className="text-xs text-muted-foreground">All events</span>
  // No provider above us — quiet rather than wrong, and never a per-cell hook.
  if (!events) return <span className="text-xs text-muted-foreground">—</span>
  return <LookupCell id={id} lookup={events} />
}

/**
 * No row actions of its own.
 *
 * Opening a notification used to need a bespoke action, because there is no
 * `GET /notifications/:id` and the detail window had to be seeded from the
 * row. `DomainTableConfig.noItemEndpoint` now does that for all twelve
 * endpoints in the same position, so the ordinary row click is enough.
 */
export function useNotificationExtras() {
  return useMemo(() => ({ rowActions: [] as RowAction<Notification>[] }), [])
}
