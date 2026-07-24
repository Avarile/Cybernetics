'use client'
import * as React from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FileDropzone } from '@/app/dashboard/file-management/components/file-dropzone'
import { FileUploadList } from '@/app/dashboard/file-management/components/file-upload-list'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import { DOC_ACCEPT, partitionIngestable } from '@/lib/upload/ingestable-docs'

const DOCUMENTS_COLLECTION = 'documents'

export function DocumentUploadDialog() {
  const isAdmin = useIsAdmin()
  const open = useDataManagementStore((s) => s.uploadOpen)
  const closeUpload = useDataManagementStore((s) => s.closeUpload)
  const startWatch = useDataManagementStore((s) => s.startWatch)
  const setCollection = useDataManagementStore((s) => s.setCollection)
  const { items, uploadAll, reset } = useFileUpload()
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = React.useState(false)

  const onFiles = async (files: File[]) => {
    const { accepted, rejected } = partitionIngestable(files)
    if (rejected.length) toast.error(`${rejected.length} file(s) skipped — only PDF, DOCX, MD, or TXT.`)
    if (!accepted.length) return
    setBusy(true)
    try {
      await uploadAll(accepted, undefined)
      if (isAdmin) {
        // Non-admins stay out of the documents browse: it's a global read with no
        // owner filter, so auto-navigating them there would leak other users' docs.
        setCollection(DOCUMENTS_COLLECTION)
        startWatch() // poll records until the async-ingested rows appear
        await mutate((key) => Array.isArray(key) && key[0] === 'records')
      }
      toast.success('Documents uploaded — the assistant can search them shortly.')
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
