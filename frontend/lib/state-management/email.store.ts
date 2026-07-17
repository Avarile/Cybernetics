'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { emailService } from '@/lib/services/email.service'
import type {
  IEmail,
  IEmailState,
  ICreateEmailDto,
  IUpdateEmailDto,
  IQueryEmailDto,
} from '@/lib/interfaces/email.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as IEmail[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const emailStoreCreator: StateCreator<
  IEmailState,
  [['zustand/devtools', never]],
  [],
  IEmailState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'email/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'email/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'email/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryEmailDto = {}) => {
    set({ isLoading: true, error: null }, false, 'email/fetchAll/pending')
    try {
      const res = await emailService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<IEmail[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'email/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch emails'
      set({ error: message, isLoading: false }, false, 'email/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'email/fetchById/pending')
    try {
      const res = await emailService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'email/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch email'
      set({ error: message, isLoading: false }, false, 'email/fetchById/rejected')
    }
  },

  create: async (dto: ICreateEmailDto) => {
    set({ isLoading: true, error: null }, false, 'email/create/pending')
    try {
      await emailService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'email/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create email'
      set({ error: message, isLoading: false }, false, 'email/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateEmailDto) => {
    set({ isLoading: true, error: null }, false, 'email/update/pending')
    try {
      await emailService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'email/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update email'
      set({ error: message, isLoading: false }, false, 'email/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'email/remove/pending')
    try {
      await emailService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'email/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete email'
      set({ error: message, isLoading: false }, false, 'email/remove/rejected')
      throw err
    }
  },
})

export const useEmailStore = create<IEmailState>()(
  devtools(emailStoreCreator, { name: 'EmailStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useEmails        = () => useEmailStore((s) => s.items)
export const useSelectedEmail = () => useEmailStore((s) => s.selected)
export const useEmailLoading  = () => useEmailStore((s) => s.isLoading)
export const useEmailError    = () => useEmailStore((s) => s.error)
export const useEmailPage     = () => useEmailStore((s) => s.page)
export const useEmailPageSize = () => useEmailStore((s) => s.pageSize)
