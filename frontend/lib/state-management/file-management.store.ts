'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { Updater } from '@tanstack/react-table'
import type { FileStatusFilter, FilesQuery } from '@/lib/interfaces/search.interface'

const DEFAULT_LIMIT = 20
const WATCH_MS = 20_000

type RowSelection = Record<string, boolean>
type ColumnVisibility = Record<string, boolean>

interface FileManagementState {
  status: FileStatusFilter
  mimeType?: string
  page: number
  limit: number
  nameFilter: string
  setStatus: (status: FileStatusFilter) => void
  setMimeType: (mimeType: string | undefined) => void
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  setNameFilter: (nameFilter: string) => void

  selection: RowSelection
  setSelection: (updater: Updater<RowSelection>) => void
  clearSelection: () => void

  columnVisibility: ColumnVisibility
  setColumnVisibility: (updater: Updater<ColumnVisibility>) => void

  uploadOpen: boolean
  detailId: string | null
  deleteTarget: string[] | null
  watchUntil: number
  openUpload: () => void
  closeUpload: () => void
  openDetail: (id: string) => void
  closeDetail: () => void
  requestDelete: (ids: string[]) => void
  cancelDelete: () => void
  startWatch: () => void
}

function applyUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
}

const creator: StateCreator<
  FileManagementState,
  [['zustand/devtools', never]],
  [],
  FileManagementState
> = (set) => ({
  status: 'ALL',
  mimeType: undefined,
  page: 1,
  limit: DEFAULT_LIMIT,
  nameFilter: '',
  setStatus: (status) => set({ status, page: 1, selection: {} }, false, 'fm/setStatus'),
  setMimeType: (mimeType) => set({ mimeType, page: 1 }, false, 'fm/setMimeType'),
  setPage: (page) => set({ page }, false, 'fm/setPage'),
  setLimit: (limit) => set({ limit, page: 1 }, false, 'fm/setLimit'),
  setNameFilter: (nameFilter) => set({ nameFilter }, false, 'fm/setNameFilter'),

  selection: {},
  setSelection: (updater) =>
    set((s) => ({ selection: applyUpdater(updater, s.selection) }), false, 'fm/setSelection'),
  clearSelection: () => set({ selection: {} }, false, 'fm/clearSelection'),

  columnVisibility: {},
  setColumnVisibility: (updater) =>
    set((s) => ({ columnVisibility: applyUpdater(updater, s.columnVisibility) }), false, 'fm/setColumnVisibility'),

  uploadOpen: false,
  detailId: null,
  deleteTarget: null,
  watchUntil: 0,
  openUpload: () => set({ uploadOpen: true }, false, 'fm/openUpload'),
  closeUpload: () => set({ uploadOpen: false }, false, 'fm/closeUpload'),
  openDetail: (id) => set({ detailId: id }, false, 'fm/openDetail'),
  closeDetail: () => set({ detailId: null }, false, 'fm/closeDetail'),
  requestDelete: (ids) => set({ deleteTarget: ids }, false, 'fm/requestDelete'),
  cancelDelete: () => set({ deleteTarget: null }, false, 'fm/cancelDelete'),
  startWatch: () => set({ watchUntil: Date.now() + WATCH_MS }, false, 'fm/startWatch'),
})

export const useFileManagementStore = create<FileManagementState>()(
  devtools(creator, { name: 'FileManagementStore', enabled: process.env.NODE_ENV === 'development' }),
)

// ── selectors ──────────────────────────────────────────────────────
export const useFileStatus = () => useFileManagementStore((s) => s.status)
export const useFileQuery = (): FilesQuery =>
  useFileManagementStore(
    useShallow((s) => ({ status: s.status, mimeType: s.mimeType, page: s.page, limit: s.limit })),
  )
