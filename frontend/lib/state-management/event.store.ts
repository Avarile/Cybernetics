'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { eventService } from '@/lib/services/event.service'
import type {
  IEvent,
  IEventState,
  ICreateEventDto,
  IUpdateEventDto,
  IQueryEventDto,
} from '@/lib/interfaces/event.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as IEvent[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const eventStoreCreator: StateCreator<
  IEventState,
  [['zustand/devtools', never]],
  [],
  IEventState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'event/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'event/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'event/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryEventDto = {}) => {
    set({ isLoading: true, error: null }, false, 'event/fetchAll/pending')
    try {
      const res = await eventService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<IEvent[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'event/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch events'
      set({ error: message, isLoading: false }, false, 'event/fetchAll/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'event/fetchById/pending')
    try {
      const res = await eventService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'event/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch event'
      set({ error: message, isLoading: false }, false, 'event/fetchById/rejected')
    }
  },

  create: async (dto: ICreateEventDto) => {
    set({ isLoading: true, error: null }, false, 'event/create/pending')
    try {
      await eventService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'event/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create event'
      set({ error: message, isLoading: false }, false, 'event/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateEventDto) => {
    set({ isLoading: true, error: null }, false, 'event/update/pending')
    try {
      await eventService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'event/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update event'
      set({ error: message, isLoading: false }, false, 'event/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'event/remove/pending')
    try {
      await eventService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'event/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete event'
      set({ error: message, isLoading: false }, false, 'event/remove/rejected')
      throw err
    }
  },
})

export const useEventStore = create<IEventState>()(
  devtools(eventStoreCreator, { name: 'EventStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useEvents          = () => useEventStore((s) => s.items)
export const useSelectedEvent   = () => useEventStore((s) => s.selected)
export const useEventLoading    = () => useEventStore((s) => s.isLoading)
export const useEventError      = () => useEventStore((s) => s.error)
export const useEventPage       = () => useEventStore((s) => s.page)
export const useEventPageSize   = () => useEventStore((s) => s.pageSize)
