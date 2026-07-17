// frontend/lib/state-management/scheduler.store.ts
'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { schedulerService } from '@/lib/services/scheduler.service'
import type {
  ISchedulerJob,
  ISchedulerState,
  IEnqueueJobDto,
  IQuerySchedulerDto,
} from '@/lib/interfaces/scheduler.interface'

const DEFAULT_QUEUE = 'slackEventQueue'

const INITIAL_STATE = {
  jobs:           [] as ISchedulerJob[],
  jobNameConfigs: [],
  selectedQueue:  DEFAULT_QUEUE,
  isLoading:      false,
  error:          null as string | null,
}

const schedulerStoreCreator: StateCreator<
  ISchedulerState,
  [['zustand/devtools', never]],
  [],
  ISchedulerState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'scheduler/clearError'),

  setQueue: (name: string) => {
    set({ selectedQueue: name }, false, 'scheduler/setQueue')
    get().fetchJobs({ queueName: name })
  },

  fetchConfigs: async () => {
    try {
      const res = await schedulerService.getConfigs()
      const configs = Array.isArray(res.data) ? res.data : []
      set({ jobNameConfigs: configs }, false, 'scheduler/fetchConfigs/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load queue configs'
      set({ error: message }, false, 'scheduler/fetchConfigs/rejected')
    }
  },

  fetchJobs: async (dto?: Partial<IQuerySchedulerDto>) => {
    const queueName = dto?.queueName ?? get().selectedQueue
    set({ isLoading: true, error: null }, false, 'scheduler/fetchJobs/pending')
    try {
      const res = await schedulerService.query({ queueName, states: dto?.states })
      const data = Array.isArray(res.data) ? res.data : []
      set({ jobs: data, isLoading: false }, false, 'scheduler/fetchJobs/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch jobs'
      set({ error: message, isLoading: false }, false, 'scheduler/fetchJobs/rejected')
    }
  },

  enqueue: async (dto: IEnqueueJobDto) => {
    set({ isLoading: true, error: null }, false, 'scheduler/enqueue/pending')
    try {
      await schedulerService.enqueue(dto)
      await get().fetchJobs()
      set({ isLoading: false }, false, 'scheduler/enqueue/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to enqueue job'
      set({ error: message, isLoading: false }, false, 'scheduler/enqueue/rejected')
      throw err
    }
  },

  cancel: async (jobId: string) => {
    const queueName = get().selectedQueue
    set({ isLoading: true, error: null }, false, 'scheduler/cancel/pending')
    try {
      await schedulerService.cancel({ queueName, jobId })
      // Optimistic removal
      set(
        (s) => ({ jobs: s.jobs.filter((j) => j.id !== jobId), isLoading: false }),
        false,
        'scheduler/cancel/fulfilled',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to cancel job'
      set({ error: message, isLoading: false }, false, 'scheduler/cancel/rejected')
      throw err
    }
  },
})

export const useSchedulerStore = create<ISchedulerState>()(
  devtools(schedulerStoreCreator, { name: 'SchedulerStore', enabled: process.env.NODE_ENV === 'development' }),
)

export const useSchedulerJobs          = () => useSchedulerStore((s) => s.jobs)
export const useSchedulerJobNameConfigs = () => useSchedulerStore((s) => s.jobNameConfigs)
export const useSchedulerLoading       = () => useSchedulerStore((s) => s.isLoading)
export const useSchedulerError         = () => useSchedulerStore((s) => s.error)
