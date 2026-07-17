'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { companyService } from '@/lib/services/company.service'
import type {
  ICompany,
  ICompanyState,
  ICreateCompanyDto,
  IUpdateCompanyDto,
  IQueryCompanyDto,
} from '@/lib/interfaces/company.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as ICompany[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const companyStoreCreator: StateCreator<
  ICompanyState,
  [['zustand/devtools', never]],
  [],
  ICompanyState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'company/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'company/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'company/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryCompanyDto = {}) => {
    set({ isLoading: true, error: null }, false, 'company/fetchAll/pending')
    try {
      const res = await companyService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<ICompany[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'company/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch companies'
      set({ error: message, isLoading: false }, false, 'company/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'company/fetchById/pending')
    try {
      const res = await companyService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'company/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch company'
      set({ error: message, isLoading: false }, false, 'company/fetchById/rejected')
    }
  },

  create: async (dto: ICreateCompanyDto) => {
    set({ isLoading: true, error: null }, false, 'company/create/pending')
    try {
      await companyService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'company/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create company'
      set({ error: message, isLoading: false }, false, 'company/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateCompanyDto) => {
    set({ isLoading: true, error: null }, false, 'company/update/pending')
    try {
      await companyService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'company/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update company'
      set({ error: message, isLoading: false }, false, 'company/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'company/remove/pending')
    try {
      await companyService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'company/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete company'
      set({ error: message, isLoading: false }, false, 'company/remove/rejected')
      throw err
    }
  },
})

export const useCompanyStore = create<ICompanyState>()(
  devtools(companyStoreCreator, { name: 'CompanyStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useCompanies        = () => useCompanyStore((s) => s.items)
export const useSelectedCompany  = () => useCompanyStore((s) => s.selected)
export const useCompanyLoading   = () => useCompanyStore((s) => s.isLoading)
export const useCompanyError     = () => useCompanyStore((s) => s.error)
export const useCompanyPage      = () => useCompanyStore((s) => s.page)
export const useCompanyPageSize  = () => useCompanyStore((s) => s.pageSize)
