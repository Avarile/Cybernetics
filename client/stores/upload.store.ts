import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import type { UploadPhase, UploadProgress } from "@/lib/files/upload"

export interface UploadItem {
  /** Local id; the server's fileId arrives once initiate returns. */
  localId: string
  filename: string
  size: number
  mimeType: string
  phase: UploadPhase
  percent: number
  fileId?: string
  error?: string
  deduplicated?: boolean
  /** False when the MIME will not be extracted into text records. */
  ingestable: boolean
}

interface UploadStoreState {
  items: UploadItem[]
  add: (item: UploadItem) => void
  update: (localId: string, progress: UploadProgress) => void
  remove: (localId: string) => void
  /** Drops everything that has finished, leaving live uploads alone. */
  clearSettled: () => void
  reset: () => void
}

const SETTLED: ReadonlySet<UploadPhase> = new Set<UploadPhase>(["indexed", "failed"])

export const isSettled = (phase: UploadPhase): boolean => SETTLED.has(phase)

export const useUploadStore = create<UploadStoreState>()(
  immer((set) => ({
    items: [],

    add: (item) =>
      set((state) => {
        state.items.push(item)
      }),

    update: (localId, progress) =>
      set((state) => {
        const item = state.items.find((i) => i.localId === localId)
        if (!item) return
        item.phase = progress.phase
        item.percent = progress.percent
        // Never unset a fileId once initiate has handed one over: later
        // progress frames for the polling phases omit it.
        // `!== undefined`, not truthiness: this must match the old
        // `progress.fileId ?? i.fileId` exactly, and stay symmetric with the
        // `deduplicated` check below.
        if (progress.fileId !== undefined) item.fileId = progress.fileId
        item.error = progress.error
        if (progress.deduplicated !== undefined) item.deduplicated = progress.deduplicated
      }),

    remove: (localId) =>
      set((state) => {
        state.items = state.items.filter((i) => i.localId !== localId)
      }),

    clearSettled: () =>
      set((state) => {
        state.items = state.items.filter((i) => !isSettled(i.phase))
      }),

    reset: () =>
      set((state) => {
        state.items = []
      }),
  })),
)
