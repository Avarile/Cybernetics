'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { costService } from '@/lib/services/cost.service'
import type {
  ICost,
  ICostState,
  ICreateCostDto,
  IUpdateCostDto,
  IQueryCostDto,
} from '@/lib/interfaces/cost.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as ICost[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const costStoreCreator: StateCreator<
  ICostState,
  [['zustand/devtools', never]],
  [],
  ICostState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'cost/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'cost/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'cost/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryCostDto = {}) => {
    set({ isLoading: true, error: null }, false, 'cost/fetchAll/pending')
    try {
      const res = await costService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<ICost[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'cost/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch costs'
      set({ error: message, isLoading: false }, false, 'cost/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'cost/fetchById/pending')
    try {
      const res = await costService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'cost/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch cost'
      set({ error: message, isLoading: false }, false, 'cost/fetchById/rejected')
    }
  },

  create: async (dto: ICreateCostDto) => {
    set({ isLoading: true, error: null }, false, 'cost/create/pending')
    try {
      await costService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'cost/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create cost'
      set({ error: message, isLoading: false }, false, 'cost/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateCostDto) => {
    set({ isLoading: true, error: null }, false, 'cost/update/pending')
    try {
      await costService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'cost/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update cost'
      set({ error: message, isLoading: false }, false, 'cost/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'cost/remove/pending')
    try {
      await costService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'cost/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete cost'
      set({ error: message, isLoading: false }, false, 'cost/remove/rejected')
      throw err
    }
  },
})

export const useCostStore = create<ICostState>()(
  devtools(costStoreCreator, { name: 'CostStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useCosts        = () => useCostStore((s) => s.items)
export const useSelectedCost = () => useCostStore((s) => s.selected)
export const useCostLoading  = () => useCostStore((s) => s.isLoading)
export const useCostError    = () => useCostStore((s) => s.error)
export const useCostPage     = () => useCostStore((s) => s.page)
export const useCostPageSize = () => useCostStore((s) => s.pageSize)
