'use client'
import { useCallback, useState } from 'react'
import { fileService } from '@/lib/services/file.service'

export type UploadStatus = 'pending' | 'hashing' | 'uploading' | 'deduplicated' | 'done' | 'error'

export interface UploadItem {
  file: File
  status: UploadStatus
  fileId?: string
  error?: string
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function useFileUpload() {
  const [items, setItems] = useState<UploadItem[]>([])

  const patch = (file: File, p: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.file === file ? { ...it, ...p } : it)))

  const uploadOne = useCallback(
    async (file: File, metadata?: Record<string, unknown>): Promise<string | null> => {
      try {
        patch(file, { status: 'hashing' })
        const sha256 = await sha256Hex(file)
        patch(file, { status: 'uploading' })
        const init = await fileService.initiate({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          sha256,
          metadata,
        })
        if (init.deduplicated) {
          patch(file, { status: 'deduplicated', fileId: init.fileId })
          return init.fileId
        }
        if (init.upload) {
          await fileService.uploadToPolicy(init.upload, file)
          await fileService.complete(init.fileId, sha256)
        }
        patch(file, { status: 'done', fileId: init.fileId })
        return init.fileId
      } catch (err) {
        patch(file, { status: 'error', error: err instanceof Error ? err.message : 'Upload failed' })
        return null
      }
    },
    [],
  )

  const uploadAll = useCallback(
    async (files: File[], metadata?: Record<string, unknown>): Promise<string[]> => {
      setItems((prev) => [...prev, ...files.map((file) => ({ file, status: 'pending' as const }))])
      const results = await Promise.all(files.map((file) => uploadOne(file, metadata)))
      return results.filter((id): id is string => id !== null)
    },
    [uploadOne],
  )

  const reset = useCallback(() => setItems([]), [])
  return { items, uploadAll, reset }
}
