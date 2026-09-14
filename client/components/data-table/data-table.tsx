"use client"

import { useMemo, useState } from "react"
import {
  ChevronDownIcon,
  Columns3Icon,
  EllipsisVerticalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { TableFilter } from "./table-filter"
import { TablePagination } from "./table-pagination"
import { TableState } from "./table-state"
import { useDomainTable } from "@/features/records/use-domain-table"
import type { DomainTableConfig, HasId } from "./types"

export interface DataTableProps<T extends HasId> {
  config: DomainTableConfig<T>
  /** Rows already in hand, for a `source: "inline"` config. */
  rows?: T[]
  onCreate?: () => void
  onEdit?: (row: T) => void
  onDelete?: (rows: T[]) => void
  onOpen?: (row: T) => void
}

/**
 * The generic domain table.
 *
 * Generalised from the vendored `components/data-table.tsx` demo: same
 * affordances (tabs, column visibility, row selection with a count, rows-per-
 * page, pager, row actions) but driven by server queries instead of a
 * client-side row model.
 *
 * TanStack is deliberately not used here. The demo needs it for client-side
 * sorting/filtering/pagination row models — all of which now live on the
 * server — and what remains is a header, a body and a selection set. Pulling
 * in the v9 feature registry to render 30 lines of markup would be ceremony,
 * not reuse.
 */
export function DataTable<T extends HasId>({
  config,
  rows: inlineRows,
  onCreate,
  onEdit,
  onDelete,
  onOpen,
}: DataTableProps<T>) {
  const table = useDomainTable(config, inlineRows)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const columns = useMemo(
    () => config.columns.filter((c) => !hidden.has(c.key)),
    [config.columns, hidden],
  )

  // Row identity. `id` for every domain but the composed ones — notification
  // preferences have an eventKey and no row to have an id.
  const idOf = (row: T) => config.rowId?.(row) ?? row.id

  const selectable = config.selectable !== false
  const selectedRows = selectable ? table.rows.filter((r) => selected.has(idOf(r))) : []
  // Only the rows this principal may actually delete. `canDelete` can be a
  // predicate now: a project viewer, a knowledge reader, a billed time entry.
  const deletableSelected = selectedRows.filter((r) => can(config.canDelete, r))
  const allOnPageSelected =
    table.rows.length > 0 && table.rows.every((r) => selected.has(idOf(r)))

  function toggleAll(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const r of table.rows) {
        if (checked) next.add(idOf(r))
        else next.delete(idOf(r))
      }
      return next
    })
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const showActions = Boolean(
    config.canEdit || config.canDelete || config.rowActions?.length,
  )
  // Header checkbox + actions column, for the empty/error row's colSpan. Get
  // this wrong and the empty state renders at half width.
  const extraCols = (selectable ? 1 : 0) + (showActions ? 1 : 0)

  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      {/* ── toolbar ─────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3">
        {config.tabs && config.tabs.length > 0 && (
          <Tabs
            value={table.query.tab}
            onValueChange={(tab) => table.setQuery({ tab })}
          >
            <TabsList>
              {config.tabs.map((t) => (
                <TabsTrigger key={t.value} value={t.value} className="text-xs">
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {config.searchable && (
          <Input
            placeholder="Search…"
            className="h-8 w-48 text-xs"
            value={table.query.search ?? ""}
            onChange={(e) => table.setQuery({ search: e.target.value })}
          />
        )}

        {config.filters?.map((f) => (
          <TableFilter
            key={f.key}
            spec={f}
            value={table.query.filters[f.key] ?? ""}
            onChange={(v) => table.setFilter(f.key, v)}
          />
        ))}

        <div className="ml-auto flex items-center gap-2">
          {deletableSelected.length > 0 && onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive"
              onClick={() => onDelete(deletableSelected)}
            >
              <Trash2Icon className="size-3.5" />
              {/* When the selection is mixed, say so on the button. Deleting
                  fewer rows than the count promised is the failure to avoid. */}
              {deletableSelected.length === selectedRows.length
                ? `Delete ${selectedRows.length}`
                : `Delete ${deletableSelected.length} of ${selectedRows.length}`}
            </Button>
          )}

          <Button
            variant="outline"
            size="icon"
            className="size-8"
            aria-label="Refresh"
            onClick={table.refresh}
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Columns3Icon className="size-3.5" />
                Columns
                <ChevronDownIcon className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {config.columns
                .filter((c) => c.hideable !== false)
                .map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.key}
                    checked={!hidden.has(c.key)}
                    onCheckedChange={(v) =>
                      setHidden((prev) => {
                        const next = new Set(prev)
                        if (v) next.delete(c.key)
                        else next.add(c.key)
                        return next
                      })
                    }
                  >
                    {c.header}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {config.canCreate && onCreate && (
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={onCreate}>
              <PlusIcon className="size-3.5" />
              New
            </Button>
          )}
        </div>
      </div>

      {config.toolbarExtra}

      {/* ── table ───────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            <TableRow>
              {selectable && (
                <TableHead className="w-8">
                  <Checkbox
                    aria-label="Select all"
                    checked={allOnPageSelected}
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                  />
                </TableHead>
              )}
              {columns.map((c) => (
                <TableHead key={c.key} className={cn(c.numeric && "text-right", c.className)}>
                  {c.header}
                </TableHead>
              ))}
              {showActions && <TableHead className="w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.status !== "ready" || table.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + extraCols}>
                  <TableState
                    status={table.status}
                    error={table.error}
                    empty={config.emptyMessage ?? "Nothing here yet."}
                    onRetry={table.refresh}
                  />
                </TableCell>
              </TableRow>
            ) : (
              table.rows.map((row) => (
                <TableRow
                  key={idOf(row)}
                  data-state={selected.has(idOf(row)) ? "selected" : undefined}
                  className={cn(onOpen && "cursor-pointer")}
                  onClick={() => onOpen?.(row)}
                >
                  {selectable && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        aria-label={`Select row ${idOf(row)}`}
                        checked={selected.has(idOf(row))}
                        onCheckedChange={(v) => toggleRow(idOf(row), Boolean(v))}
                      />
                    </TableCell>
                  )}
                  {columns.map((c) => (
                    <TableCell
                      key={c.key}
                      className={cn(c.numeric && "text-right tabular-nums", c.className)}
                    >
                      {c.cell(row)}
                    </TableCell>
                  ))}
                  {showActions && (
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <RowMenu
                        row={row}
                        config={config}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {config.footnote?.({ total: table.total, hiddenOnPage: table.hiddenOnPage })}

      <TablePagination
        page={table.query.page}
        limit={table.query.limit}
        total={table.total}
        selectedCount={selectedRows.length}
        onPage={(page) => table.setQuery({ page })}
        onLimit={(limit) => table.setQuery({ limit })}
      />
    </div>
  )
}

/** Resolve a guard that may be a flag or a per-row predicate. */
function can<T>(guard: boolean | ((row: T) => boolean) | undefined, row: T): boolean {
  return typeof guard === "function" ? guard(row) : Boolean(guard)
}

function RowMenu<T extends HasId>({
  row,
  config,
  onEdit,
  onDelete,
}: {
  row: T
  config: DomainTableConfig<T>
  onEdit?: (row: T) => void
  onDelete?: (rows: T[]) => void
}) {
  // Actions the user cannot perform are hidden, not disabled: a control that
  // can never be enabled is noise. `canEdit`/`canDelete` are resolved per row
  // for the same reason — the server already told us what this principal may
  // do to THIS row (PublicProject.access), so offering Edit on a row that
  // will 403 is a promise we know we cannot keep.
  const custom = (config.rowActions ?? []).filter((a) => a.visible?.(row) !== false)
  const editable = can(config.canEdit, row)
  const deletable = can(config.canDelete, row)

  // Every item resolved away — render nothing rather than an empty menu.
  if (!custom.length && !(editable && onEdit) && !(deletable && onDelete)) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="Row actions"
        >
          <EllipsisVerticalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {editable && onEdit && (
          <DropdownMenuItem onClick={() => onEdit(row)}>
            <PencilIcon className="size-3.5" /> Edit
          </DropdownMenuItem>
        )}
        {custom.map((a) => (
          <DropdownMenuItem
            key={a.label}
            variant={a.destructive ? "destructive" : undefined}
            onClick={() => a.onSelect(row)}
          >
            {a.icon && <a.icon className="size-3.5" />}
            {a.label}
          </DropdownMenuItem>
        ))}
        {deletable && onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => onDelete([row])}>
              <Trash2Icon className="size-3.5" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
