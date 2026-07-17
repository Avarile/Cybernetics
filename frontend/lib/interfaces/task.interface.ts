import type { IRelationRef } from './shared.interface'

export type TaskType = 'project' | 'standalone' | 'adhoc'
export type TaskStatus = 'not_started' | 'in_progress' | 'testing' | 'completed' | 'cancelled' | 'no_show' | 'on_hold'

export interface ITask {
  id: number
  slug: string
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type: TaskType
  status: TaskStatus
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectID?: number | null
  projectSlug?: string | null
  projectName?: string | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateTaskDto {
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type: TaskType
  status: TaskStatus
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectID?: number | null
  projectSlug?: string | null
}

export interface IUpdateTaskDto {
  id: number
  name?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type?: TaskType
  status?: TaskStatus
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectID?: number | null
  projectSlug?: string | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteTaskDto {
  id: number
}

export interface IQueryTaskDto {
  name?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type?: TaskType
  status?: TaskStatus
  projectID?: number | null
  projectSlug?: string | null
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface ITaskState {
  items: ITask[]
  selected: ITask | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryTaskDto) => Promise<void>
  fetchAllForGraph: () => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateTaskDto) => Promise<void>
  update: (dto: IUpdateTaskDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: ITask | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
