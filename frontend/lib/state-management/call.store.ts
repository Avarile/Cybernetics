'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { callService } from '@/lib/services/call.service'
import type {
  ICall,
  ICallState,
  ICreateCallDto,
  IUpdateCallDto,
  IQueryCallDto,
} from '@/lib/interfaces/call.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as ICall[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const callStoreCreator: StateCreator<
  ICallState,
  [['zustand/devtools', never]],
  [],
  ICallState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'call/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'call/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'call/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryCallDto = {}) => {
    set({ isLoading: true, error: null }, false, 'call/fetchAll/pending')
    try {
      const res = await callService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<ICall[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'call/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch calls'
      set({ error: message, isLoading: false }, false, 'call/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'call/fetchById/pending')
    try {
      const res = await callService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'call/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch call'
      set({ error: message, isLoading: false }, false, 'call/fetchById/rejected')
    }
  },

  create: async (dto: ICreateCallDto) => {
    set({ isLoading: true, error: null }, false, 'call/create/pending')
    try {
      await callService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'call/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create call'
      set({ error: message, isLoading: false }, false, 'call/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateCallDto) => {
    set({ isLoading: true, error: null }, false, 'call/update/pending')
    try {
      await callService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'call/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update call'
      set({ error: message, isLoading: false }, false, 'call/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'call/remove/pending')
    try {
      await callService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'call/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete call'
      set({ error: message, isLoading: false }, false, 'call/remove/rejected')
      throw err
    }
  },
})

export const useCallStore = create<ICallState>()(
  devtools(callStoreCreator, { name: 'CallStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useCalls        = () => useCallStore((s) => s.items)
export const useSelectedCall = () => useCallStore((s) => s.selected)
export const useCallLoading  = () => useCallStore((s) => s.isLoading)
export const useCallError    = () => useCallStore((s) => s.error)
export const useCallPage     = () => useCallStore((s) => s.page)
export const useCallPageSize = () => useCallStore((s) => s.pageSize)
