export type NotificationType = 'info' | 'warning' | 'alert'

export interface INotification {
  id: number
  slug: string
  title: string
  message: string
  notificationType: NotificationType
  isRead: boolean
  entityType?: string | null
  entityId?: string | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt?: string | null
}

export interface ICreateNotificationDto {
  title: string
  message: string
  notificationType: NotificationType
  isRead?: boolean
  entityType?: string | null
  entityId?: string | null
}

export interface IQueryNotificationDto {
  notificationType?: NotificationType
  isRead?: boolean
  entityType?: string | null
  entityId?: string | null
  id?: number
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface INotificationState {
  items: INotification[]
  selected: INotification | null
  isLoading: boolean
  error: string | null
  fetchAll: (query?: IQueryNotificationDto) => Promise<void>
  markAsRead: (id: number) => Promise<void>
  markAllAsRead: () => Promise<void>
  setSelected: (item: INotification | null) => void
  clearError: () => void
}
