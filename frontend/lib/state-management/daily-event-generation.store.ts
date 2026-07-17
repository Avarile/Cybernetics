'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { dailyEventGenerationService } from '@/lib/services/daily-event-generation.service'
import type { IDailyEventGenerationState } from '@/lib/interfaces/daily-event-generation.interface'

const INITIAL_STATE = {
  currentEventContext: null as import('@/lib/interfaces/daily-event-generation.interface').IConversationMessage[] | null,
  isLoading: false,
  error: null as string | null,
}

const dailyEventGenerationStoreCreator: StateCreator<
  IDailyEventGenerationState,
  [['zustand/devtools', never]],
  [],
  IDailyEventGenerationState
> = (set) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'dailyEventGeneration/clearError'),

  clearCurrentEventContext: () =>
    set({ currentEventContext: null }, false, 'dailyEventGeneration/clearCurrentEventContext'),

  fetchByEvent: async (dailySummaryID: number, eventID: number) => {
    set({ isLoading: true, error: null, currentEventContext: null }, false, 'dailyEventGeneration/fetchByEvent/pending')
    try {
      const res = await dailyEventGenerationService.getByEvent(dailySummaryID, eventID)
      const context = res.data?.context ?? null
      set(
        { currentEventContext: context, isLoading: false },
        false,
        'dailyEventGeneration/fetchByEvent/fulfilled',
      )
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to fetch event context'
      set({ error: message, isLoading: false }, false, 'dailyEventGeneration/fetchByEvent/rejected')
    }
  },
})

export const useDailyEventGenerationStore = create<IDailyEventGenerationState>()(
  devtools(dailyEventGenerationStoreCreator, {
    name: 'DailyEventGenerationStore',
    enabled: process.env.NODE_ENV === 'development',
  }),
)

export const useCurrentEventContext = () =>
  useDailyEventGenerationStore((s) => s.currentEventContext)
export const useDailyEventGenerationLoading = () =>
  useDailyEventGenerationStore((s) => s.isLoading)
export const useDailyEventGenerationError = () =>
  useDailyEventGenerationStore((s) => s.error)
