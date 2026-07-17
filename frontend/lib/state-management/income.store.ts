'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { incomeService } from '@/lib/services/income.service'
import type {
  IIncome,
  IIncomeState,
  ICreateIncomeDto,
  IUpdateIncomeDto,
  IQueryIncomeDto,
} from '@/lib/interfaces/income.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as IIncome[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const incomeStoreCreator: StateCreator<
  IIncomeState,
  [['zustand/devtools', never]],
  [],
  IIncomeState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'income/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'income/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'income/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryIncomeDto = {}) => {
    set({ isLoading: true, error: null }, false, 'income/fetchAll/pending')
    try {
      const res = await incomeService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<IIncome[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'income/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch incomes'
      set({ error: message, isLoading: false }, false, 'income/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'income/fetchById/pending')
    try {
      const res = await incomeService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'income/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch income'
      set({ error: message, isLoading: false }, false, 'income/fetchById/rejected')
    }
  },

  create: async (dto: ICreateIncomeDto) => {
    set({ isLoading: true, error: null }, false, 'income/create/pending')
    try {
      await incomeService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'income/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create income'
      set({ error: message, isLoading: false }, false, 'income/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateIncomeDto) => {
    set({ isLoading: true, error: null }, false, 'income/update/pending')
    try {
      await incomeService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'income/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update income'
      set({ error: message, isLoading: false }, false, 'income/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'income/remove/pending')
    try {
      await incomeService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'income/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete income'
      set({ error: message, isLoading: false }, false, 'income/remove/rejected')
      throw err
    }
  },
})

export const useIncomeStore = create<IIncomeState>()(
  devtools(incomeStoreCreator, { name: 'IncomeStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useIncomes        = () => useIncomeStore((s) => s.items)
export const useSelectedIncome = () => useIncomeStore((s) => s.selected)
export const useIncomeLoading  = () => useIncomeStore((s) => s.isLoading)
export const useIncomeError    = () => useIncomeStore((s) => s.error)
export const useIncomePage     = () => useIncomeStore((s) => s.page)
export const useIncomePageSize = () => useIncomeStore((s) => s.pageSize)
