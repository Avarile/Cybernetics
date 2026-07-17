'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { contactService } from '@/lib/services/contact.service'
import type {
  IContact,
  IContactState,
  ICreateContactDto,
  IUpdateContactDto,
  IQueryContactDto,
} from '@/lib/interfaces/contact.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as IContact[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const contactStoreCreator: StateCreator<
  IContactState,
  [['zustand/devtools', never]],
  [],
  IContactState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'contact/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'contact/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'contact/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryContactDto = {}) => {
    set({ isLoading: true, error: null }, false, 'contact/fetchAll/pending')
    try {
      const res = await contactService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<IContact[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'contact/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch contacts'
      set({ error: message, isLoading: false }, false, 'contact/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'contact/fetchById/pending')
    try {
      const res = await contactService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'contact/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch contact'
      set({ error: message, isLoading: false }, false, 'contact/fetchById/rejected')
    }
  },

  create: async (dto: ICreateContactDto) => {
    set({ isLoading: true, error: null }, false, 'contact/create/pending')
    try {
      await contactService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'contact/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create contact'
      set({ error: message, isLoading: false }, false, 'contact/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateContactDto) => {
    set({ isLoading: true, error: null }, false, 'contact/update/pending')
    try {
      await contactService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'contact/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update contact'
      set({ error: message, isLoading: false }, false, 'contact/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'contact/remove/pending')
    try {
      await contactService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'contact/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete contact'
      set({ error: message, isLoading: false }, false, 'contact/remove/rejected')
      throw err
    }
  },
})

export const useContactStore = create<IContactState>()(
  devtools(contactStoreCreator, { name: 'ContactStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useContacts         = () => useContactStore((s) => s.items)
export const useSelectedContact  = () => useContactStore((s) => s.selected)
export const useContactLoading   = () => useContactStore((s) => s.isLoading)
export const useContactError     = () => useContactStore((s) => s.error)
export const useContactPage      = () => useContactStore((s) => s.page)
export const useContactPageSize  = () => useContactStore((s) => s.pageSize)
