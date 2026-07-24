'use client'
import * as React from 'react'
import { useSWRConfig } from 'swr'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileDropzone } from '@/app/dashboard/file-management/components/file-dropzone'
import { FileUploadList } from '@/app/dashboard/file-management/components/file-upload-list'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import { DOC_ACCEPT, partitionIngestable } from '@/lib/upload/ingestable-docs'

const DOCUMENTS_COLLECTION = 'documents'

export function DocumentUploadDialog() {
  const open = useDataManagementStore((s) => s.uploadOpen)
  const closeUpload = useDataManagementStore((s) => s.closeUpload)
  const startWatch = useDataManagementStore((s) => s.startWatch)
  const setCollection = useDataManagementStore((s) => s.setCollection)
  const { items, uploadAll, reset } = useFileUpload()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = React.useState(false)

  const onFiles = async (files: File[]) => {
    const { accepted } = partitionIngestable(files)
    if (!accepted.length) return
    setBusy(true)
    try {
      await uploadAll(accepted, undefined)
      setCollection(DOCUMENTS_COLLECTION) // show the docs collection so the new records land in view
      startWatch() // poll records until the async-ingested rows appear
      await mutate((key) => Array.isArray(key) && key[0] === 'records')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { closeUpload(); reset() } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>
            PDF, DOCX, or Markdown files are extracted into searchable records the assistant can use.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FileDropzone onFiles={(files) => void onFiles(files)} disabled={busy} accept={DOC_ACCEPT} />
          <FileUploadList items={items} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
