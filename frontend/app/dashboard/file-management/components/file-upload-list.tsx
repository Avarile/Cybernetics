'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon, Alert02Icon } from '@hugeicons/core-free-icons'
import { Progress } from '@/components/ui/progress'
import { formatBytes } from './file-format'
import type { UploadItem, UploadStatus } from '@/lib/hooks/use-file-upload'

const LABELS: Record<UploadStatus, string> = {
  pending: 'Waiting…',
  hashing: 'Hashing…',
  uploading: 'Uploading…',
  deduplicated: 'Deduplicated',
  done: 'Uploaded',
  error: 'Failed',
}

const INDETERMINATE: UploadStatus[] = ['hashing', 'uploading']

export function FileUploadList({ items }: { items: UploadItem[] }) {
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-3">
      {items.map((it, i) => (
        <li key={`${it.file.name}-${i}`} className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate font-medium">{it.file.name}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {it.status === 'done' || it.status === 'deduplicated' ? (
                <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="size-3.5 text-emerald-600" />
              ) : it.status === 'error' ? (
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-3.5 text-destructive" />
              ) : null}
              {LABELS[it.status]}
            </span>
          </div>
          {INDETERMINATE.includes(it.status) ? (
            <Progress className="h-1.5" />
          ) : (
            <div className="text-xs text-muted-foreground">
              {it.status === 'error' ? it.error : formatBytes(it.file.size)}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
