'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { HugeiconsIcon } from '@hugeicons/react'
import type { FileMetadata } from '@/lib/interfaces/search.interface'
import { FileStatusBadge } from './file-status-badge'
import { formatBytes, formatDateTime, mimeIconFor, mimeLabel, quarantineReason } from './file-format'

export function buildFileColumns(): ColumnDef<FileMetadata>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex items-center gap-2 font-medium">
          <HugeiconsIcon
            icon={mimeIconFor(row.original.mimeType)}
            strokeWidth={2}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="truncate max-w-[22rem]">{row.original.filename}</span>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: ({ row }) => <span className="text-muted-foreground">{mimeLabel(row.original.mimeType)}</span>,
    },
    {
      id: 'size',
      header: 'Size',
      cell: ({ row }) => <span className="tabular-nums">{formatBytes(row.original.size)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <FileStatusBadge status={row.original.status} reason={quarantineReason(row.original.metadata)} />
      ),
    },
    {
      id: 'created',
      header: 'Uploaded',
      cell: ({ row }) => (
        <span className="text-muted-foreground">{formatDateTime(row.original.createdAt)}</span>
      ),
    },
  ]
}
