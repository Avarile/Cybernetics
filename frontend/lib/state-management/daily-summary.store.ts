'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { dailySummaryService } from '@/lib/services/daily-summary.service'
import type {
  IDailySummary,
  IDailySummaryState,
  ICreateDailySummaryDto,
  IUpdateDailySummaryDto,
  IUpdateDailySummaryEventsDto,
  IUpsertTodayEventsDto,
  IQueryDailySummaryDto,
} from '@/lib/interfaces/daily-summary.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as IDailySummary[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const dailySummaryStoreCreator: StateCreator<
  IDailySummaryState,
  [['zustand/devtools', never]],
  [],
  IDailySummaryState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'dailySummary/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'dailySummary/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'dailySummary/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryDailySummaryDto = {}) => {
    set({ isLoading: true, error: null }, false, 'dailySummary/fetchAll/pending')
    try {
      const res = await dailySummaryService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<IDailySummary[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'dailySummary/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch daily summaries'
      set({ error: message, isLoading: false }, false, 'dailySummary/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'dailySummary/fetchById/pending')
    try {
      const res = await dailySummaryService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'dailySummary/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch daily summary'
      set({ error: message, isLoading: false }, false, 'dailySummary/fetchById/rejected')
    }
  },

  fetchToday: async () => {
    set({ isLoading: true, error: null }, false, 'dailySummary/fetchToday/pending')
    try {
      const res = await dailySummaryService.getToday()
      set({ selected: res.data, isLoading: false }, false, 'dailySummary/fetchToday/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to fetch today's daily summary"
      set({ error: message, isLoading: false }, false, 'dailySummary/fetchToday/rejected')
    }
  },

  fetchLatest: async () => {
    set({ isLoading: true, error: null }, false, 'dailySummary/fetchLatest/pending')
    try {
      const res = await dailySummaryService.getLatest()
      set({ selected: res.data, isLoading: false }, false, 'dailySummary/fetchLatest/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch latest daily summary'
      set({ error: message, isLoading: false }, false, 'dailySummary/fetchLatest/rejected')
    }
  },

  create: async (dto: ICreateDailySummaryDto) => {
    set({ isLoading: true, error: null }, false, 'dailySummary/create/pending')
    try {
      const res = await dailySummaryService.create(dto)
      const created = res.data
      await get().fetchAll()
      set({ selected: created, isLoading: false }, false, 'dailySummary/create/fulfilled')
      return created
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create daily summary'
      set({ error: message, isLoading: false }, false, 'dailySummary/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateDailySummaryDto) => {
    set({ isLoading: true, error: null }, false, 'dailySummary/update/pending')
    try {
      const res = await dailySummaryService.update(dto)
      set({ selected: res.data }, false, 'dailySummary/update/selected')
      await get().fetchAll()
      set({ isLoading: false }, false, 'dailySummary/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update daily summary'
      set({ error: message, isLoading: false }, false, 'dailySummary/update/rejected')
      throw err
    }
  },

  updateEvents: async (dto: IUpdateDailySummaryEventsDto) => {
    set({ isLoading: true, error: null }, false, 'dailySummary/updateEvents/pending')
    try {
      const res = await dailySummaryService.updateEvents(dto)
      set({ selected: res.data, isLoading: false }, false, 'dailySummary/updateEvents/fulfilled')
      await get().fetchAll()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update events'
      set({ error: message, isLoading: false }, false, 'dailySummary/updateEvents/rejected')
      throw err
    }
  },

  upsertTodayEvents: async (dto: IUpsertTodayEventsDto) => {
    set({ isLoading: true, error: null }, false, 'dailySummary/upsertTodayEvents/pending')
    try {
      const res = await dailySummaryService.upsertTodayEvents(dto)
      set({ selected: res.data }, false, 'dailySummary/upsertTodayEvents/selected')
      await get().fetchAll()
      set({ isLoading: false }, false, 'dailySummary/upsertTodayEvents/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to upsert today events'
      set({ error: message, isLoading: false }, false, 'dailySummary/upsertTodayEvents/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'dailySummary/remove/pending')
    try {
      await dailySummaryService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), total: Math.max(0, s.total - 1), isLoading: false }),
        false,
        'dailySummary/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete daily summary'
      set({ error: message, isLoading: false }, false, 'dailySummary/remove/rejected')
      throw err
    }
  },
})

export const useDailySummaryStore = create<IDailySummaryState>()(
  devtools(dailySummaryStoreCreator, { name: 'DailySummaryStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useDailySummaryItems    = () => useDailySummaryStore((s) => s.items)
export const useSelectedDailySummary = () => useDailySummaryStore((s) => s.selected)
export const useDailySummaryLoading  = () => useDailySummaryStore((s) => s.isLoading)
export const useDailySummaryError    = () => useDailySummaryStore((s) => s.error)
export const useDailySummaryPage     = () => useDailySummaryStore((s) => s.page)
export const useDailySummaryPageSize = () => useDailySummaryStore((s) => s.pageSize)
