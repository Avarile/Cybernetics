'use client'
import { useCallback, useState } from 'react'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { partitionIngestable } from '@/lib/upload/ingestable-docs'

/** Composer attachments: uploads ingestable docs on-add (owner-scoped, tagged with
 *  the conversation when one exists). Non-doc files are rejected (counted). */
export function useChatAttachments(conversationId: string | null) {
  const { items, uploadAll, reset: resetUpload } = useFileUpload()
  const [rejectedCount, setRejectedCount] = useState(0)

  const addFiles = useCallback(
    async (files: File[]) => {
      const { accepted, rejected } = partitionIngestable(files)
      if (rejected.length) setRejectedCount((n) => n + rejected.length)
      if (!accepted.length) return
      await uploadAll(accepted, conversationId ? { conversationId } : undefined)
    },
    [uploadAll, conversationId],
  )

  const reset = useCallback(() => {
    resetUpload()
    setRejectedCount(0)
  }, [resetUpload])

  return { items, addFiles, reset, rejectedCount }
}
