export type EventStatus = 'not_started' | 'in_progress' | 'testing' | 'completed' | 'cancelled' | 'no_show' | 'on_hold'

export interface IEventItem {
  /** Optional linked entity ID (typically a task id). */
  id?: number
  /** Optional start time (UI-friendly string, e.g. new Date().toLocaleTimeString()). */
  startAt?: string
  /** Optional end time (UI-friendly string, e.g. new Date().toLocaleTimeString()). */
  endAt?: string
  name: string
  context: string
  status: EventStatus
}

export interface IDailySummary {
  id: number
  slug: string
  events?: IEventItem[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateDailySummaryDto {
  events?: IEventItem[] | null
  createdAt?: string
}

export interface IUpdateDailySummaryDto {
  id: number
  events?: IEventItem[] | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IUpdateDailySummaryEventsDto {
  id: number
  events: IEventItem[]
}

export interface IUpsertTodayEventsDto {
  events: IEventItem[]
}

export interface IDeleteDailySummaryDto {
  id: number
}

export interface IQueryDailySummaryDto {
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface IDailySummaryState {
  items: IDailySummary[]
  selected: IDailySummary | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryDailySummaryDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  fetchToday: () => Promise<void>
  fetchLatest: () => Promise<void>
  create: (dto: ICreateDailySummaryDto) => Promise<IDailySummary>
  update: (dto: IUpdateDailySummaryDto) => Promise<void>
  updateEvents: (dto: IUpdateDailySummaryEventsDto) => Promise<void>
  upsertTodayEvents: (dto: IUpsertTodayEventsDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: IDailySummary | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
