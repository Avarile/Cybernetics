'use client'

import * as React from 'react'
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef,
} from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import { LeftToRightListBulletIcon, RefreshIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { buildFileColumns } from './file-columns'
import { FileRowActions } from './file-row-actions'
import { FilePagination } from './file-pagination'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const PAGE_SIZES = [10, 20, 30, 50]

export function FileDataTable({
  items, pageCount, totalItems, isLoading, error, onRetry,
}: {
  items: FileMetadata[]
  pageCount: number
  totalItems: number
  isLoading: boolean
  error?: unknown
  onRetry: () => void
}) {
  const s = useFileManagementStore()

  const columns = React.useMemo<ColumnDef<FileMetadata>[]>(() => {
    const select: ColumnDef<FileMetadata> = {
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
    const actions: ColumnDef<FileMetadata> = {
      id: 'actions',
      enableHiding: false,
      cell: ({ row }) => <FileRowActions file={row.original} />,
    }
    return [select, ...buildFileColumns(), actions]
  }, [])

  const table = useReactTable({
    data: items,
    columns,
    state: {
      rowSelection: s.selection,
      columnVisibility: s.columnVisibility,
      pagination: { pageIndex: s.page - 1, pageSize: s.limit },
    },
    getRowId: (row) => row.id,
    enableRowSelection: true,
    onRowSelectionChange: s.setSelection,
    onColumnVisibilityChange: s.setColumnVisibility,
    onPaginationChange: (updater) => {
      const prev = { pageIndex: s.page - 1, pageSize: s.limit }
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next.pageSize !== s.limit) s.setLimit(next.pageSize)
      else if (next.pageIndex !== prev.pageIndex) s.setPage(next.pageIndex + 1)
    },
    manualPagination: true,
    pageCount,
    getCoreRowModel: getCoreRowModel(),
  })

  const visibleColumnCount = table.getVisibleLeafColumns().length
  const selectedCount = Object.keys(s.selection).length

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {selectedCount > 0 ? `${selectedCount} selected` : `${totalItems} file(s)`}
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
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>Could not load files</EmptyTitle>
                      <EmptyDescription>The file service may be unavailable.</EmptyDescription>
                    </EmptyHeader>
                    <Button variant="outline" onClick={onRetry}>
                      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} /> Retry
                    </Button>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : isLoading && items.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {table.getVisibleLeafColumns().map((col) => (
                    <TableCell key={col.id}><Skeleton className="h-5 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((r) => (
                <TableRow key={r.id} data-state={r.getIsSelected() && 'selected'}>
                  {r.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumnCount} className="h-40">
                  <Empty>
                    <EmptyHeader>
                      <EmptyTitle>No files</EmptyTitle>
                      <EmptyDescription>Upload a file or adjust your filters.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <FilePagination table={table} isLoading={isLoading} pageSizeOptions={PAGE_SIZES} />
    </div>
  )
}
