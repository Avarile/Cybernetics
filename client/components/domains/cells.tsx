"use client"

import type { ReactNode } from "react"
import { LockIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Lookup } from "@/features/records/use-lookup"

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

/** The em dash for an absent value. */
export function Dash() {
  return <span className="text-muted-foreground">—</span>
}

export function dash(v: string | null | undefined): ReactNode {
  return v == null || v === "" ? <Dash /> : v
}

export interface StatusStyle {
  label: string
  variant: BadgeVariant
}

/** A status or kind enum as a badge, from a map the domain config owns. */
export function StatusBadge({
  value,
  map,
}: {
  value: string | null | undefined
  map: Record<string, StatusStyle>
}) {
  if (!value) return <Dash />
  const style = map[value]
  return (
    <Badge variant={style?.variant ?? "secondary"} className="text-xs">
      {style?.label ?? value}
    </Badge>
  )
}

export const PRIORITY_STYLES: Record<string, StatusStyle> = {
  low: { label: "Low", variant: "outline" },
  medium: { label: "Medium", variant: "secondary" },
  high: { label: "High", variant: "default" },
  urgent: { label: "Urgent", variant: "destructive" },
}

/**
 * A decimal money string, formatted WITHOUT a float round-trip.
 *
 * Amounts are `numeric(20, 4)` and travel as strings precisely because they
 * are not floats (`money.util.ts`: "never a float"). `Number("12345678901234.5678")`
 * loses the last digits silently, and a ledger that is wrong in the fourth
 * decimal place is worse than one that refuses to render.
 *
 * So the integer part is grouped with Intl and the fraction is appended as
 * text — the digits that arrive are the digits displayed.
 */
export function formatAmount(amount: string, locale?: string): string {
  const negative = amount.startsWith("-")
  const bare = negative ? amount.slice(1) : amount
  const [whole = "0", fraction] = bare.split(".")

  let grouped: string
  try {
    grouped = new Intl.NumberFormat(locale).format(BigInt(whole))
  } catch {
    // Not an integer string after all — show it as it came rather than guess.
    grouped = whole
  }

  // Money reads as two places; the extra two exist for rounding, not display.
  const cents = (fraction ?? "").padEnd(2, "0").slice(0, 2)
  return `${negative ? "-" : ""}${grouped}.${cents}`
}

export function Money({
  amount,
  currency,
  /** Income reads positive, expense negative, transfer neutral — the sign is
   *  carried by `kind`, never by the column. */
  signed,
}: {
  amount: string | null | undefined
  currency?: string | null
  signed?: "positive" | "negative" | null
}) {
  if (amount == null || amount === "") return <Dash />
  const text = formatAmount(amount)
  return (
    <span
      className={cn(
        "tabular-nums",
        signed === "positive" && "text-emerald-600 dark:text-emerald-400",
        signed === "negative" && "text-destructive",
      )}
    >
      {signed === "negative" ? "−" : ""}
      {text}
      {currency && <span className="ml-1 text-xs text-muted-foreground">{currency}</span>}
    </span>
  )
}

/**
 * A `date` column — `YYYY-MM-DD`, not a timestamp.
 *
 * Rendered by splitting the string, never through `new Date(...)`: a bare
 * date parses as UTC midnight and displays as the previous day for anyone
 * west of Greenwich. An invoice dated the 1st must not read as the 31st.
 */
export function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <Dash />
  const [y, m, d] = value.slice(0, 10).split("-")
  if (!y || !m || !d) return <span className="text-xs">{value}</span>
  return <span className="text-xs tabular-nums">{`${y}-${m}-${d}`}</span>
}

/** A true timestamp, where the local zone IS the right answer. */
export function TimeCell({ value }: { value: string | null | undefined }) {
  if (!value) return <Dash />
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return <Dash />
  return (
    <span className="text-xs text-muted-foreground" title={at.toISOString()}>
      {at.toLocaleDateString()}
    </span>
  )
}

/** Minutes as `2h 30m`. */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return "—"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function Duration({ minutes }: { minutes: number | null | undefined }) {
  if (minutes == null) return <Dash />
  return <span className="text-xs tabular-nums">{formatDuration(minutes)}</span>
}

/**
 * A used-of-budget bar.
 *
 * Tinted at the row's own alert threshold rather than a fixed number: a
 * budget that alerts at 50% and one that alerts at 95% should not look the
 * same at 60%.
 */
export function ProgressCell({
  value,
  total,
  thresholdPct = 80,
}: {
  value: string | number | null | undefined
  total?: string | number | null
  thresholdPct?: number
}) {
  const used = Number(value ?? 0)
  const cap = total == null ? 100 : Number(total)
  if (!Number.isFinite(used) || !Number.isFinite(cap) || cap <= 0) return <Dash />

  const pct = (used / cap) * 100
  return (
    <span className="flex items-center gap-2">
      <Progress
        value={Math.min(100, pct)}
        className={cn(
          "h-1.5 w-16",
          pct >= 100 && "[&>*]:bg-destructive",
          pct >= thresholdPct && pct < 100 && "[&>*]:bg-amber-500",
        )}
      />
      <span className="text-xs tabular-nums text-muted-foreground">{Math.round(pct)}%</span>
    </span>
  )
}

/**
 * A foreign key as a label.
 *
 * While the lookup is loading this renders a skeleton, not the raw id — a
 * uuid flashing into a name is worse than a beat of nothing, and a uuid that
 * never resolves reads as data corruption.
 */
export function LookupCell({
  id,
  lookup,
}: {
  id: string | null | undefined
  lookup: Lookup
}) {
  if (id == null || id === "") return <Dash />
  if (lookup.isLoading) return <Skeleton className="h-4 w-20" />
  if (!lookup.has(id)) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-xs text-muted-foreground">{lookup.label(id)}…</span>
        </TooltipTrigger>
        <TooltipContent>{id}</TooltipContent>
      </Tooltip>
    )
  }
  return <span className="text-xs">{lookup.label(id)}</span>
}

/** The "already billed / already invoiced" lock. */
export function LockedCell({ locked, reason }: { locked: boolean; reason: string }) {
  if (!locked) return <Dash />
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <LockIcon className="size-3.5 text-muted-foreground" aria-label={reason} />
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

/** Indents a materialised-path tree node inside a flat table. */
export function TreeName({ depth, name }: { depth: number; name: string }) {
  return (
    <span className="font-medium" style={{ paddingLeft: `${Math.min(depth, 6) * 12}px` }}>
      {name}
    </span>
  )
}
