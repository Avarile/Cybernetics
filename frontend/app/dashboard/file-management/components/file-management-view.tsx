'use client'

import * as React from 'react'
import { useFiles } from '@/lib/hooks/use-files'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { FileToolbar } from './file-toolbar'
import { FileStatusTabs } from './file-status-tabs'
import { FileDataTable } from './file-data-table'
import { FileUploadDialog } from './file-upload-dialog'
import { FileDetailDrawer } from './file-detail-drawer'
import { FileDeleteDialog } from './file-delete-dialog'

export function FileManagementView() {
  const { data, isLoading, error, mutate } = useFiles()
  const nameFilter = useFileManagementStore((s) => s.nameFilter)
  const limit = useFileManagementStore((s) => s.limit)

  const items = React.useMemo(() => {
    const all = data?.items ?? []
    const q = nameFilter.trim().toLowerCase()
    return q ? all.filter((f) => f.filename.toLowerCase().includes(q)) : all
  }, [data, nameFilter])

  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">File Management</h1>
        <p className="text-sm text-muted-foreground">
          Upload, browse, download, and review your files.
        </p>
      </div>

      <FileStatusTabs />
      <FileToolbar onRefresh={() => void mutate()} />

      <FileDataTable
        items={items}
        pageCount={pageCount}
        totalItems={total}
        isLoading={isLoading}
        error={error}
        onRetry={() => void mutate()}
      />

      <FileUploadDialog />
      <FileDetailDrawer />
      <FileDeleteDialog />
    </div>
  )
}
