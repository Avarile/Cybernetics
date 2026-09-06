"use client"

import { useCallback } from "react"
import { nanoid } from "nanoid"
import { useShallow } from "zustand/react/shallow"
import { isIngestable, uploadFile } from "@/lib/files/upload"
import { scopes } from "@/lib/swr/keys"
import { useApi } from "@/lib/swr/provider"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { useUploadStore } from "@/stores/upload.store"

const FILES_ENDPOINT = "/files"

/**
 * Uploads, and the list refresh each finished one implies.
 *
 * The dropzone used to call an `onUploaded` prop that its parent turned into a
 * `refreshToken` counter, so only the Files window that owned the dropzone ever
 * saw new rows.
 */
export function useFileUploads() {
  const { client } = useApi()
  const invalidate = useInvalidate()
  const items = useUploadStore(useShallow((s) => s.items))

  const start = useCallback(
    async (files: FileList | File[]) => {
      const store = useUploadStore.getState()
      // The list only actually changed if initiate got far enough to create
      // a row: `initiateUpload` creates a PENDING row server-side as soon as
      // it succeeds, before any upload/complete/poll happens (file.service.ts),
      // and the default list tab has no status filter — so that row is
      // already visible to a refetch even when everything after initiate
      // fails (a dropped upload, a failed complete, a poll timeout, a
      // quarantine). `uploadFile` never rejects and collapses all of those
      // failures into a `null` return (see lib/files/upload.ts), so the
      // thing that actually proves initiate got through for at least one
      // file is a progress frame that ever carried a `fileId` — not just the
      // final frame, since a post-initiate failure's terminal `failed` frame
      // doesn't itself carry one.
      let anyFileIdSeen = false
      await Promise.all(
        Array.from(files).map(async (file) => {
          const localId = nanoid()
          const mimeType = file.type || "application/octet-stream"
          store.add({
            localId,
            filename: file.name,
            size: file.size,
            mimeType,
            phase: "queued",
            percent: 0,
            ingestable: isIngestable(mimeType),
          })
          return uploadFile({
            client,
            file,
            onProgress: (p) => {
              if (p.fileId !== undefined) anyFileIdSeen = true
              store.update(localId, p)
            },
          })
        }),
      )
      // `anyFileIdSeen` alone is sufficient: every path that yields a non-null
      // result emits a `fileId` frame first — the dedup path at upload.ts:171,
      // and the normal flow at :183/:187/:191/:194 — so a successful upload
      // always implies this flag. Checking the results as well would be dead
      // code. If upload.ts ever stops emitting a fileId on a success path,
      // this guard must be revisited.
      if (anyFileIdSeen) {
        await invalidate(scopes.allLists(FILES_ENDPOINT))
      }
    },
    [client, invalidate],
  )

  return {
    items,
    start,
    remove: useUploadStore((s) => s.remove),
    clearSettled: useUploadStore((s) => s.clearSettled),
  }
}
