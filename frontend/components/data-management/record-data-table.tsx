'use client'

import * as React from 'react'
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef,
} from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowUp01Icon, ArrowDown01Icon, ArrowUpDownIcon, LeftToRightListBulletIcon,
  MoreVerticalCircle01Icon, RefreshIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { DataPagination } from '@/components/ui/data-pagination'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import { buildColumns, type RecordColumnMeta } from '@/lib/schema/field-to-column'
import type { FieldSpec, RecordHit, SearchResults } from '@/lib/interfaces/search.interface'

const PAGE_SIZES = [10, 20, 30, 50]

export function RecordDataTable({
  fields,
  results,
  isLoading,
  error,
  onRetry,
}: {
  fields: FieldSpec[]
  results?: SearchResults
  isLoading: boolean
  error?: unknown
  onRetry: () => void
}) {
  const isAdmin = useIsAdmin()
  const s = useDataManagementStore()

  const columns = React.useMemo<ColumnDef<RecordHit>[]>(() => {
    const dataCols = buildColumns(fields)
    const select: ColumnDef<RecordHit> = {
      id: 'select',
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
        />
      ),
    }
    const actions: ColumnDef<RecordHit> = {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
              <HugeiconsIcon icon={MoreVerticalCircle01Icon} strokeWidth={2} />
              <span className="sr-only">Open menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32">
            <DropdownMenuItem onClick={() => s.openDetail(row.original.id)}>
              {isAdmin ? 'Edit' : 'View'}
            </DropdownMenuItem>
            {isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => s.requestDelete([row.original.id])}>
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }
    return [select, ...dataCols, actions]
  }, [fields, isAdmin, s])

  const table = useReactTable({
    data: results?.hits ?? [],
    columns,
    state: { rowSelection: s.selection, columnVisibility: s.columnVisibility },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: s.setSelection,
    onColumnVisibilityChange: s.setColumnVisibility,
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: results?.totalPages ?? 0,
    getCoreRowModel: getCoreRowModel(),
  })

  const visibleColumnCount = table.getVisibleLeafColumns().length

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {Object.keys(s.selection).length > 0
            ? `${Object.keys(s.selection).length} selected`
            : results
              ? `${results.totalHits} record(s)`
              : ''}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <HugeiconsIcon icon={LeftToRightListBulletIcon} strokeWidth={2} />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            {table.getAllColumns().filter((c) => c.getCanHide()).map((c) => (
              <DropdownMenuCheckboxItem
                key={c.id}
                className="capitalize"
                checked={c.getIsVisible()}
                onCheckedChange={(v) => c.toggleVisibility(!!v)}
              >
                {c.id}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta as RecordColumnMeta | undefined
                  const sortable = meta?.field.sortable
                  const active = s.sort[0]?.field === meta?.field.name ? s.sort[0] : undefined
                  return (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : sortable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="-ml-2 h-8"
                          onClick={() => s.toggleSort(meta!.field.name)}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <HugeiconsIcon
                            icon={active ? (active.dir === 'asc' ? ArrowUp01Icon : ArrowDown01Icon) : ArrowUpDownIcon}
                            strokeWidth={2}
                            className="size-3.5"
                          />
                        </Button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Could not load records</EmptyTitle>
                      <EmptyDescription>The search service may be unavailable.</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={onRetry}>
                      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} /> Retry
                    </Button>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : isLoading && !results ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {table.getVisibleLeafColumns().map((col) => (
                    <TableCell key={col.id}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No records</EmptyTitle>
                      <EmptyDescription>Try adjusting your search or filters.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="hidden items-center gap-2 lg:flex">
          <Label htmlFor="rows-per-page" className="text-sm font-medium">Rows per page</Label>
          <Select value={String(s.limit)} onValueChange={(v) => s.setLimit(Number(v))}>
            <SelectTrigger size="sm" className="w-20" id="rows-per-page"><SelectValue /></SelectTrigger>
            <SelectContent side="top">
              <SelectGroup>
                {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <DataPagination
          page={s.page}
          pageSize={s.limit}
          total={results?.totalHits ?? 0}
          onPageChange={s.setPage}
          isLoading={isLoading}
        />
      </div>
    </div>
  )
}
