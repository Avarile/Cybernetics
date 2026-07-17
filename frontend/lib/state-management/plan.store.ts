'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { planService } from '@/lib/services/plan.service'
import type {
  IPlan,
  IPlanState,
  ICreatePlanDto,
  IUpdatePlanDto,
  IQueryPlanDto,
} from '@/lib/interfaces/plan.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as IPlan[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const planStoreCreator: StateCreator<
  IPlanState,
  [['zustand/devtools', never]],
  [],
  IPlanState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'plan/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'plan/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'plan/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryPlanDto = {}) => {
    set({ isLoading: true, error: null }, false, 'plan/fetchAll/pending')
    try {
      const res = await planService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<IPlan[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'plan/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch plans'
      set({ error: message, isLoading: false }, false, 'plan/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'plan/fetchById/pending')
    try {
      const res = await planService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'plan/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch plan'
      set({ error: message, isLoading: false }, false, 'plan/fetchById/rejected')
    }
  },

  create: async (dto: ICreatePlanDto) => {
    set({ isLoading: true, error: null }, false, 'plan/create/pending')
    try {
      await planService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'plan/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create plan'
      set({ error: message, isLoading: false }, false, 'plan/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdatePlanDto) => {
    set({ isLoading: true, error: null }, false, 'plan/update/pending')
    try {
      await planService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'plan/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update plan'
      set({ error: message, isLoading: false }, false, 'plan/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'plan/remove/pending')
    try {
      await planService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'plan/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete plan'
      set({ error: message, isLoading: false }, false, 'plan/remove/rejected')
      throw err
    }
  },
})

export const usePlanStore = create<IPlanState>()(
  devtools(planStoreCreator, { name: 'PlanStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const usePlans         = () => usePlanStore((s) => s.items)
export const useSelectedPlan  = () => usePlanStore((s) => s.selected)
export const usePlanLoading   = () => usePlanStore((s) => s.isLoading)
export const usePlanError     = () => usePlanStore((s) => s.error)
export const usePlanPage      = () => usePlanStore((s) => s.page)
export const usePlanPageSize  = () => usePlanStore((s) => s.pageSize)
