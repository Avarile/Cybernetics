import type { IRelationRef } from './shared.interface'

export interface IEvent {
  id: number
  slug: string
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  isAllDay?: boolean
  isPassed?: boolean
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateEventDto {
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  isAllDay?: boolean
  isPassed?: boolean
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IUpdateEventDto {
  id: number
  name?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  isAllDay?: boolean
  isPassed?: boolean
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteEventDto {
  id: number
}

export interface IQueryEventDto {
  name?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  isAllDay?: boolean
  isPassed?: boolean
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface IEventState {
  items: IEvent[]
  selected: IEvent | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryEventDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateEventDto) => Promise<void>
  update: (dto: IUpdateEventDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: IEvent | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
