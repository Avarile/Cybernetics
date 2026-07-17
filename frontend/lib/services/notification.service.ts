import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type { INotification, ICreateNotificationDto, IQueryNotificationDto } from '@/lib/interfaces/notification.interface'

export const notificationService = {
  search(dto: IQueryNotificationDto = {}): Promise<IApiResponse<INotification[]>> {
    return apiClient.post<IApiResponse<INotification[]>>('/notifications/search', dto).then((r) => r.data)
  },
  create(dto: ICreateNotificationDto): Promise<IApiResponse<INotification>> {
    return apiClient.post<IApiResponse<INotification>>('/notifications/create', dto).then((r) => r.data)
  },
  markAsRead(id: number): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/notifications/mark-read', { id }).then((r) => r.data)
  },
  markAllAsRead(): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/notifications/mark-all-read', {}).then((r) => r.data)
  },
  getUnreadCount(): Promise<IApiResponse<{ count: number }>> {
    return apiClient.get<IApiResponse<{ count: number }>>('/notifications/unread-count').then((r) => r.data)
  },
}
