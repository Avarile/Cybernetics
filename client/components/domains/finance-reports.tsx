"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useReport } from "@/features/records/use-report"
import { formatAmount } from "./cells"

interface SummaryRow {
  income?: string
  expense?: string
  net?: string
  currency?: string
  [key: string]: unknown
}

interface CategoryRow {
  categoryId: string | null
  categoryName?: string | null
  name?: string | null
  total: string
}

/** The current quarter, as two ISO dates. */
function currentQuarter(): { from: string; to: string } {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const start = new Date(Date.UTC(now.getFullYear(), q * 3, 1))
  const end = new Date(Date.UTC(now.getFullYear(), q * 3 + 3, 0))
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(start), to: iso(end) }
}

/**
 * Finance reports — the one section that is not a table.
 *
 * A report is an aggregate, not a row set. Forcing it through `DataTable`
 * would mean a table with no id column, no selection, no pager and no row
 * actions: every affordance the component exists to provide, switched off.
 *
 * The two category breakdowns ARE tabular, and are rendered as plain tables
 * with inline bars for the same reason — they have no row identity and
 * nothing to act on.
 */
export function FinanceReports() {
  const [range, setRange] = useState(currentQuarter)
  const qs = `from=${range.from}&to=${range.to}`

  // A blank date is not a range: the DTO requires both, so an incomplete
  // form must not fire three requests that all 422.
  const ready = Boolean(range.from && range.to)
  const summary = useReport<SummaryRow>(ready ? `/finance/reports/summary?${qs}` : null)
  const income = useReport<CategoryRow[]>(
    ready ? `/finance/reports/income-by-category?${qs}` : null,
  )
  const spend = useReport<CategoryRow[]>(
    ready ? `/finance/reports/spend-by-category?${qs}` : null,
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-from" className="text-xs">
            From
          </Label>
          <Input
            id="report-from"
            type="date"
            className="h-8 w-40 text-xs"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-to" className="text-xs">
            To
          </Label>
          <Input
            id="report-to"
            type="date"
            className="h-8 w-40 text-xs"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </div>
      </div>

      <div className="grid shrink-0 gap-3 sm:grid-cols-3">
        <Figure label="Income" value={summary.data?.income} loading={summary.isLoading} />
        <Figure label="Expense" value={summary.data?.expense} loading={summary.isLoading} />
        <Figure label="Net" value={summary.data?.net} loading={summary.isLoading} />
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-2">
        <Breakdown title="Income by category" rows={income.data} loading={income.isLoading} />
        <Breakdown title="Spending by category" rows={spend.data} loading={spend.isLoading} />
      </div>
    </div>
  )
}

function Figure({
  label,
  value,
  loading,
}: {
  label: string
  value: string | undefined
  loading: boolean
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <CardDescription className="text-xs">{label}</CardDescription>
        {loading ? (
          <Skeleton className="mt-1 h-7 w-28" />
        ) : (
          <CardTitle className="mt-1 text-2xl tabular-nums">
            {value == null ? "—" : formatAmount(value)}
          </CardTitle>
        )}
      </CardContent>
    </Card>
  )
}

function Breakdown({
  title,
  rows,
  loading,
}: {
  title: string
  rows: CategoryRow[] | undefined
  loading: boolean
}) {
  // Share of the largest row, so the bars compare against each other rather
  // than against an arbitrary ceiling.
  const max = useMemo(() => {
    if (!rows?.length) return 0
    return rows.reduce((m, r) => Math.max(m, Math.abs(Number(r.total) || 0)), 0)
  }, [rows])

  return (
    <Card className="min-h-0">
      <CardContent className="p-4">
        <CardTitle className="text-sm">{title}</CardTitle>

        {loading ? (
          <div className="mt-3 flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : !rows?.length ? (
          <p className="mt-3 text-xs text-muted-foreground">Nothing in this period.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {rows.map((r, i) => (
              <li key={r.categoryId ?? `row-${i}`} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-xs">
                  {r.categoryName ?? r.name ?? "Uncategorised"}
                </span>
                <Progress
                  value={max === 0 ? 0 : (Math.abs(Number(r.total) || 0) / max) * 100}
                  className="h-1.5 flex-1"
                />
                <span className="w-28 shrink-0 text-right text-xs tabular-nums">
                  {formatAmount(r.total)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
