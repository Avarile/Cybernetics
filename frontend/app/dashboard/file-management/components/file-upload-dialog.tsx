'use client'

import * as React from 'react'
import { useSWRConfig } from 'swr'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { FileDropzone } from './file-dropzone'
import { FileUploadList } from './file-upload-list'

export function FileUploadDialog() {
  const open = useFileManagementStore((s) => s.uploadOpen)
  const closeUpload = useFileManagementStore((s) => s.closeUpload)
  const startWatch = useFileManagementStore((s) => s.startWatch)
  const { items, uploadAll, reset } = useFileUpload()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = React.useState(false)

  const onFiles = async (files: File[]) => {
    setBusy(true)
    try {
      await uploadAll(files)
      await mutate((key) => Array.isArray(key) && key[0] === 'files')
      startWatch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) { closeUpload(); reset() }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload files</DialogTitle>
          <DialogDescription>
            Files are hashed locally to deduplicate and verify integrity, then uploaded directly to storage.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FileDropzone onFiles={(files) => void onFiles(files)} disabled={busy} />
          <FileUploadList items={items} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
