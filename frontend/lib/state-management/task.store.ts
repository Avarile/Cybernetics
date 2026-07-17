'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { taskService } from '@/lib/services/task.service'
import type {
  ITask,
  ITaskState,
  ICreateTaskDto,
  IUpdateTaskDto,
  IQueryTaskDto,
} from '@/lib/interfaces/task.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as ITask[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const taskStoreCreator: StateCreator<
  ITaskState,
  [['zustand/devtools', never]],
  [],
  ITaskState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'task/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'task/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'task/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryTaskDto = {}) => {
    set({ isLoading: true, error: null }, false, 'task/fetchAll/pending')
    try {
      const res = await taskService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<ITask[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'task/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch tasks'
      set({ error: message, isLoading: false }, false, 'task/fetchAll/rejected')
    }
  },

  fetchAllForGraph: async () => {
    set({ isLoading: true, error: null }, false, 'task/fetchAllForGraph/pending')
    try {
      const res = await taskService.fetchAll()
      const data = Array.isArray(res.data) ? res.data : []
      set({ items: data, total: data.length, isLoading: false }, false, 'task/fetchAllForGraph/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch all tasks'
      set({ error: message, isLoading: false }, false, 'task/fetchAllForGraph/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'task/fetchById/pending')
    try {
      const res = await taskService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'task/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch task'
      set({ error: message, isLoading: false }, false, 'task/fetchById/rejected')
    }
  },

  create: async (dto: ICreateTaskDto) => {
    set({ isLoading: true, error: null }, false, 'task/create/pending')
    try {
      await taskService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'task/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create task'
      set({ error: message, isLoading: false }, false, 'task/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateTaskDto) => {
    set({ isLoading: true, error: null }, false, 'task/update/pending')
    try {
      await taskService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'task/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update task'
      set({ error: message, isLoading: false }, false, 'task/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'task/remove/pending')
    try {
      await taskService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'task/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete task'
      set({ error: message, isLoading: false }, false, 'task/remove/rejected')
      throw err
    }
  },
})

export const useTaskStore = create<ITaskState>()(
  devtools(taskStoreCreator, { name: 'TaskStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useTasks        = () => useTaskStore((s) => s.items)
export const useSelectedTask = () => useTaskStore((s) => s.selected)
export const useTaskLoading  = () => useTaskStore((s) => s.isLoading)
export const useTaskError    = () => useTaskStore((s) => s.error)
export const useTaskPage     = () => useTaskStore((s) => s.page)
export const useTaskPageSize = () => useTaskStore((s) => s.pageSize)
