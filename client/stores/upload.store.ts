import { create } from "zustand"
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

export const useUploadStore = create<UploadStoreState>((set) => ({
  items: [],

  add: (item) => set((s) => ({ items: [...s.items, item] })),

  update: (localId, progress) =>
    set((s) => ({
      items: s.items.map((i) =>
        i.localId === localId
          ? {
              ...i,
              phase: progress.phase,
              percent: progress.percent,
              // Never unset a fileId once initiate has handed one over: later
              // progress frames for the polling phases omit it.
              fileId: progress.fileId ?? i.fileId,
              error: progress.error,
              deduplicated: progress.deduplicated ?? i.deduplicated,
            }
          : i,
      ),
    })),

  remove: (localId) => set((s) => ({ items: s.items.filter((i) => i.localId !== localId) })),

  clearSettled: () => set((s) => ({ items: s.items.filter((i) => !isSettled(i.phase)) })),

  reset: () => set({ items: [] }),
}))

export const selectActiveUploads = (s: UploadStoreState): UploadItem[] =>
  s.items.filter((i) => !isSettled(i.phase))
