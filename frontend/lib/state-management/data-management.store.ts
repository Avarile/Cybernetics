'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'
import type { Updater } from '@tanstack/react-table'
import type { FilterValue, SearchQuery, SortSpec } from '@/lib/interfaces/search.interface'

const DEFAULT_LIMIT = 20

type RowSelection = Record<string, boolean>
type ColumnVisibility = Record<string, boolean>

export type CollectionPanel =
  | { kind: 'closed' } | { kind: 'list' } | { kind: 'create' } | { kind: 'edit'; name: string }

interface DataManagementState {
  collection: string | null
  setCollection: (name: string) => void

  q: string
  page: number
  limit: number
  filters: Record<string, FilterValue>
  sort: SortSpec[]
  setSearch: (q: string) => void
  setPage: (page: number) => void
  setLimit: (limit: number) => void
  setFilter: (field: string, value: FilterValue | undefined) => void
  clearFilters: () => void
  toggleSort: (field: string) => void
  resetQuery: () => void

  selection: RowSelection
  setSelection: (updater: Updater<RowSelection>) => void
  clearSelection: () => void

  columnVisibility: ColumnVisibility
  setColumnVisibility: (updater: Updater<ColumnVisibility>) => void

  panel: 'closed' | 'create'
  detailId: string | null
  deleteTarget: string[] | null
  openCreate: () => void
  closeCreate: () => void
  openDetail: (id: string) => void
  closeDetail: () => void
  requestDelete: (ids: string[]) => void
  cancelDelete: () => void

  collectionPanel: CollectionPanel
  openCollections: () => void
  openCreateCollection: () => void
  openEditCollection: (name: string) => void
  closeCollectionPanel: () => void
}

const QUERY_DEFAULTS = {
  q: '',
  page: 1,
  filters: {} as Record<string, FilterValue>,
  sort: [] as SortSpec[],
}

function applyUpdater<T>(updater: Updater<T>, prev: T): T {
  return typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater
}

const creator: StateCreator<
  DataManagementState,
  [['zustand/devtools', never]],
  [],
  DataManagementState
> = (set) => ({
  collection: null,
  setCollection: (name) =>
    set(
      { collection: name, ...QUERY_DEFAULTS, limit: DEFAULT_LIMIT, selection: {} },
      false,
      'dm/setCollection',
    ),

  ...QUERY_DEFAULTS,
  limit: DEFAULT_LIMIT,
  setSearch: (q) => set({ q, page: 1 }, false, 'dm/setSearch'),
  setPage: (page) => set({ page }, false, 'dm/setPage'),
  setLimit: (limit) => set({ limit, page: 1 }, false, 'dm/setLimit'),
  setFilter: (field, value) =>
    set(
      (s) => {
        const filters = { ...s.filters }
        if (value === undefined) delete filters[field]
        else filters[field] = value
        return { filters, page: 1 }
      },
      false,
      'dm/setFilter',
    ),
  clearFilters: () => set({ filters: {}, page: 1 }, false, 'dm/clearFilters'),
  toggleSort: (field) =>
    set(
      (s) => {
        const current = s.sort[0]
        if (!current || current.field !== field) return { sort: [{ field, dir: 'asc' }] }
        if (current.dir === 'asc') return { sort: [{ field, dir: 'desc' }] }
        return { sort: [] }
      },
      false,
      'dm/toggleSort',
    ),
  resetQuery: () => set({ ...QUERY_DEFAULTS }, false, 'dm/resetQuery'),

  selection: {},
  setSelection: (updater) =>
    set((s) => ({ selection: applyUpdater(updater, s.selection) }), false, 'dm/setSelection'),
  clearSelection: () => set({ selection: {} }, false, 'dm/clearSelection'),

  columnVisibility: {},
  setColumnVisibility: (updater) =>
    set((s) => ({ columnVisibility: applyUpdater(updater, s.columnVisibility) }), false, 'dm/setColumnVisibility'),

  panel: 'closed',
  detailId: null,
  deleteTarget: null,
  openCreate: () => set({ panel: 'create' }, false, 'dm/openCreate'),
  closeCreate: () => set({ panel: 'closed' }, false, 'dm/closeCreate'),
  openDetail: (id) => set({ detailId: id }, false, 'dm/openDetail'),
  closeDetail: () => set({ detailId: null }, false, 'dm/closeDetail'),
  requestDelete: (ids) => set({ deleteTarget: ids }, false, 'dm/requestDelete'),
  cancelDelete: () => set({ deleteTarget: null }, false, 'dm/cancelDelete'),

  collectionPanel: { kind: 'closed' },
  openCollections: () => set({ collectionPanel: { kind: 'list' } }, false, 'dm/openCollections'),
  openCreateCollection: () => set({ collectionPanel: { kind: 'create' } }, false, 'dm/openCreateCollection'),
  openEditCollection: (name) => set({ collectionPanel: { kind: 'edit', name } }, false, 'dm/openEditCollection'),
  closeCollectionPanel: () => set({ collectionPanel: { kind: 'closed' } }, false, 'dm/closeCollectionPanel'),
})

export const useDataManagementStore = create<DataManagementState>()(
  devtools(creator, { name: 'DataManagementStore', enabled: process.env.NODE_ENV === 'development' }),
)

// ── selectors ──────────────────────────────────────────────────────
export const useCollection = () => useDataManagementStore((s) => s.collection)
export const useSetCollection = () => useDataManagementStore((s) => s.setCollection)
export const useRecordQuery = (): SearchQuery =>
  useDataManagementStore(
    useShallow((s) => ({ q: s.q, page: s.page, limit: s.limit, filters: s.filters, sort: s.sort })),
  )
