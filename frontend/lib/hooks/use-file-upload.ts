'use client'
import { useCallback, useState } from 'react'
import { fileService } from '@/lib/services/file.service'

export interface UploadItem {
  file: File
  status: 'pending' | 'uploading' | 'done' | 'error'
  fileId?: string
  error?: string
}

export function useFileUpload() {
  const [items, setItems] = useState<UploadItem[]>([])

  const patch = (file: File, p: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.file === file ? { ...it, ...p } : it)))

  const uploadAll = useCallback(
    async (files: File[], metadata?: Record<string, unknown>): Promise<string[]> => {
      setItems((prev) => [...prev, ...files.map((file) => ({ file, status: 'pending' as const }))])
      const ids: string[] = []
      for (const file of files) {
        try {
          patch(file, { status: 'uploading' })
          const init = await fileService.initiate({
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            metadata,
          })
          if (!init.deduplicated && init.upload) {
            await fileService.uploadToPolicy(init.upload, file)
            await fileService.complete(init.fileId)
          }
          patch(file, { status: 'done', fileId: init.fileId })
          ids.push(init.fileId)
        } catch (err) {
          patch(file, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
          const rest = files.slice(files.indexOf(file) + 1)
          if (rest.length) {
            setItems((prev) =>
              prev.map((it) =>
                rest.includes(it.file)
                  ? { ...it, status: 'error' as const, error: 'Skipped — a previous upload failed' }
                  : it,
              ),
            )
          }
          throw err
        }
      }
      return ids
    },
    [],
  )

  const reset = useCallback(() => setItems([]), [])
  return { items, uploadAll, reset }
}
