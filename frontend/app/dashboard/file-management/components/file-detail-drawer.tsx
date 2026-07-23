'use client'

import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Download01Icon, Delete02Icon, Alert02Icon } from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import {
  Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { useFileDetail } from '@/lib/hooks/use-file-detail'
import { fileService } from '@/lib/services/file.service'
import { FileStatusBadge } from './file-status-badge'
import { formatBytes, formatDateTime, mimeLabel, quarantineReason } from './file-format'

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all font-mono text-sm' : 'text-sm'}>{value}</dd>
    </div>
  )
}

export function FileDetailDrawer() {
  const detailId = useFileManagementStore((s) => s.detailId)
  const closeDetail = useFileManagementStore((s) => s.closeDetail)
  const requestDelete = useFileManagementStore((s) => s.requestDelete)
  const { file, isLoading } = useFileDetail(detailId)

  const available = file?.status === 'AVAILABLE'
  const reason = file ? quarantineReason(file.metadata) : null

  const download = async () => {
    if (!file) return
    try {
      const url = await fileService.downloadUrl(file.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not get a download link')
    }
  }

  return (
    <Drawer open={detailId !== null} onOpenChange={(o) => { if (!o) closeDetail() }} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{file?.filename ?? 'File details'}</DrawerTitle>
          <DrawerDescription>File metadata and integrity information.</DrawerDescription>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-4">
          {isLoading && !file ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : file ? (
            <dl className="flex flex-col gap-4">
              <Row label="Status" value={<FileStatusBadge status={file.status} reason={reason} />} />
              {reason && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span>This file was quarantined: <strong>{reason}</strong>. Downloads are disabled.</span>
                </div>
              )}
              <Row label="Type" value={`${mimeLabel(file.mimeType)} (${file.mimeType})`} />
              <Row label="Size" value={formatBytes(file.size)} />
              <Row label="SHA-256" value={file.checksumSha256 ?? '— (not yet computed)'} mono />
              <Row label="File ID" value={file.id} mono />
              <Row label="Uploaded" value={formatDateTime(file.createdAt)} />
              <Row label="Updated" value={formatDateTime(file.updatedAt)} />
            </dl>
          ) : null}
        </div>

        <DrawerFooter className="flex-row gap-2">
          <Button className="flex-1" disabled={!available} onClick={() => void download()}>
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} /> Download
          </Button>
          <Button
            variant="destructive"
            disabled={!file}
            onClick={() => { if (file) requestDelete([file.id]) }}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} /> Delete
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
