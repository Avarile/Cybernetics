'use client'

import { create, type StateCreator } from 'zustand'
import { devtools } from 'zustand/middleware'
import { ApiError } from '@/lib/http/api-client'
import { notificationService } from '@/lib/services/notification.service'
import type { INotification, INotificationState, IQueryNotificationDto } from '@/lib/interfaces/notification.interface'

const INITIAL_STATE = {
  items: [] as INotification[],
  selected: null as INotification | null,
  isLoading: false,
  error: null as string | null,
}

const notificationStoreCreator: StateCreator<
  INotificationState,
  [['zustand/devtools', never]],
  [],
  INotificationState
> = (set, get) => ({
  ...INITIAL_STATE,

  clearError: () => set({ error: null }, false, 'notification/clearError'),

  setSelected: (item) => set({ selected: item }, false, 'notification/setSelected'),

  fetchAll: async (query: IQueryNotificationDto = {}) => {
    set({ isLoading: true, error: null }, false, 'notification/fetchAll/pending')
    try {
      const res = await notificationService.search({ ...query, pageSize: 50 })
      const data = Array.isArray(res.data) ? res.data : []
      set({ items: data, isLoading: false }, false, 'notification/fetchAll/fulfilled')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch notifications'
      set({ error: message, isLoading: false }, false, 'notification/fetchAll/rejected')
    }
  },

  markAsRead: async (id: number) => {
    try {
      await notificationService.markAsRead(id)
      set(
        (state) => ({
          items: state.items.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        }),
        false,
        'notification/markAsRead',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to mark notification as read'
      set({ error: message }, false, 'notification/markAsRead/rejected')
    }
  },

  markAllAsRead: async () => {
    try {
      await notificationService.markAllAsRead()
      set(
        (state) => ({
          items: state.items.map((n) => ({ ...n, isRead: true })),
        }),
        false,
        'notification/markAllAsRead',
      )
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to mark all notifications as read'
      set({ error: message }, false, 'notification/markAllAsRead/rejected')
    }
  },
})

export const useNotificationStore = create<INotificationState>()(
  devtools(notificationStoreCreator, { name: 'NotificationStore' }),
)

export const useNotificationItems    = () => useNotificationStore((s) => s.items)
export const useNotificationLoading  = () => useNotificationStore((s) => s.isLoading)
export const useNotificationError    = () => useNotificationStore((s) => s.error)
export const useSelectedNotification = () => useNotificationStore((s) => s.selected)
// Derived — count unread notifications from the loaded items list
export const useNotificationUnreadCount = () => useNotificationStore((s) => s.items.filter((n) => !n.isRead).length)
