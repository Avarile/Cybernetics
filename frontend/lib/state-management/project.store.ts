'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { projectService } from '@/lib/services/project.service'
import type {
  IProject,
  IProjectState,
  ICreateProjectDto,
  IUpdateProjectDto,
  IQueryProjectDto,
} from '@/lib/interfaces/project.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'

const INITIAL_STATE = {
  items: [] as IProject[],
  selected: null,
  isLoading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 20,
}

const projectStoreCreator: StateCreator<
  IProjectState,
  [['zustand/devtools', never]],
  [],
  IProjectState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'project/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'project/setSelected'),

  setPage: (page: number) => {
    set({ page }, false, 'project/setPage')
    get().fetchAll()
  },

  fetchAll: async (query: IQueryProjectDto = {}) => {
    set({ isLoading: true, error: null }, false, 'project/fetchAll/pending')
    try {
      const res = await projectService.search({ ...query, page: get().page, pageSize: get().pageSize }) as IPaginatedApiResponse<IProject[]>
      const data = Array.isArray(res.data) ? res.data : []
      const total = res.pagination?.total ?? data.length
      set({ items: data, total, isLoading: false }, false, 'project/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch projects'
      set({ error: message, isLoading: false }, false, 'project/fetchAll/rejected')
    }
  },

  fetchAllForGraph: async () => {
    set({ isLoading: true, error: null }, false, 'project/fetchAllForGraph/pending')
    try {
      const res = await projectService.fetchAll()
      const data = Array.isArray(res.data) ? res.data : []
      set({ items: data, total: data.length, isLoading: false }, false, 'project/fetchAllForGraph/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch all projects'
      set({ error: message, isLoading: false }, false, 'project/fetchAllForGraph/rejected')
    }
  },

  fetchById: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'project/fetchById/pending')
    try {
      const res = await projectService.getById(id)
      set({ selected: res.data, isLoading: false }, false, 'project/fetchById/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch project'
      set({ error: message, isLoading: false }, false, 'project/fetchById/rejected')
    }
  },

  create: async (dto: ICreateProjectDto) => {
    set({ isLoading: true, error: null }, false, 'project/create/pending')
    try {
      await projectService.create(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'project/create/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to create project'
      set({ error: message, isLoading: false }, false, 'project/create/rejected')
      throw err
    }
  },

  update: async (dto: IUpdateProjectDto) => {
    set({ isLoading: true, error: null }, false, 'project/update/pending')
    try {
      await projectService.update(dto)
      await get().fetchAll()
      set({ isLoading: false }, false, 'project/update/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to update project'
      set({ error: message, isLoading: false }, false, 'project/update/rejected')
      throw err
    }
  },

  remove: async (id: number) => {
    set({ isLoading: true, error: null }, false, 'project/remove/pending')
    try {
      await projectService.remove({ id })
      set(
        (s) => ({ items: s.items.filter((i) => i.id !== id), isLoading: false }),
        false,
        'project/remove/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to delete project'
      set({ error: message, isLoading: false }, false, 'project/remove/rejected')
      throw err
    }
  },
})

export const useProjectStore = create<IProjectState>()(
  devtools(projectStoreCreator, { name: 'ProjectStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useProjects        = () => useProjectStore((s) => s.items)
export const useSelectedProject = () => useProjectStore((s) => s.selected)
export const useProjectLoading  = () => useProjectStore((s) => s.isLoading)
export const useProjectError    = () => useProjectStore((s) => s.error)
export const useProjectPage     = () => useProjectStore((s) => s.page)
export const useProjectPageSize = () => useProjectStore((s) => s.pageSize)
