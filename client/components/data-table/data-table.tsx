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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { TablePagination } from "./table-pagination"
import { TableState } from "./table-state"
import { useDomainTable } from "./use-domain-table"
import type { DomainTableConfig, HasId } from "./types"

export interface DataTableProps<T extends HasId> {
  config: DomainTableConfig<T>
  onCreate?: () => void
  onEdit?: (row: T) => void
  onDelete?: (rows: T[]) => void
  onOpen?: (row: T) => void
  /** Bump to force a refetch from outside the table. */
  refreshToken?: number
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
  onCreate,
  onEdit,
  onDelete,
  onOpen,
  refreshToken = 0,
}: DataTableProps<T>) {
  const table = useDomainTable(config, refreshToken)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  const columns = useMemo(
    () => config.columns.filter((c) => !hidden.has(c.key)),
    [config.columns, hidden],
  )

  const selectedRows = table.rows.filter((r) => selected.has(r.id))
  const allOnPageSelected =
    table.rows.length > 0 && table.rows.every((r) => selected.has(r.id))

  function toggleAll(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const r of table.rows) {
        if (checked) next.add(r.id)
        else next.delete(r.id)
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
          <Select
            key={f.key}
            value={table.query.filters[f.key] ?? "__all"}
            onValueChange={(v) => table.setFilter(f.key, v === "__all" ? "" : v)}
          >
            <SelectTrigger size="sm" className="h-8 w-auto min-w-28 text-xs">
              <SelectValue placeholder={f.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">{f.label}: any</SelectItem>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {selectedRows.length > 0 && config.canDelete && onDelete && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive"
              onClick={() => onDelete(selectedRows)}
            >
              <Trash2Icon className="size-3.5" />
              Delete {selectedRows.length}
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
              <TableHead className="w-8">
                <Checkbox
                  aria-label="Select all"
                  checked={allOnPageSelected}
                  onCheckedChange={(v) => toggleAll(Boolean(v))}
                />
              </TableHead>
              {columns.map((c) => (
                <TableHead key={c.key} className={c.className}>
                  {c.header}
                </TableHead>
              ))}
              {showActions && <TableHead className="w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.status !== "ready" || table.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (showActions ? 2 : 1)}>
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
                  key={row.id}
                  data-state={selected.has(row.id) ? "selected" : undefined}
                  className={cn(onOpen && "cursor-pointer")}
                  onClick={() => onOpen?.(row)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select row ${row.id}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={(v) => toggleRow(row.id, Boolean(v))}
                    />
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={c.className}>
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
  // can never be enabled is noise.
  const custom = (config.rowActions ?? []).filter((a) => a.visible?.(row) !== false)

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
      <DropdownMenuContent align="end" className="w-36">
        {config.canEdit && onEdit && (
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
        {config.canDelete && onDelete && (
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
