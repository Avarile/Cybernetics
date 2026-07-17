import type { IRelationRef } from './shared.interface'

export type PlanRange = 'weekly' | 'monthly' | 'quarterly' | 'annually'
export type PlanStatus = 'preparing' | 'active' | 'pending' | 'completed' | 'cancelled' | 'expired'

export interface IPlan {
  id: number
  slug: string
  name: string
  description?: string | null
  range: PlanRange
  status: PlanStatus
  metadata?: unknown[] | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreatePlanDto {
  name: string
  description?: string | null
  range: PlanRange
  status: PlanStatus
  metadata?: unknown[] | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IUpdatePlanDto {
  id: number
  name?: string
  description?: string | null
  range?: PlanRange
  status?: PlanStatus
  metadata?: unknown[] | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IDeletePlanDto {
  id: number
}

export interface IQueryPlanDto {
  name?: string
  description?: string | null
  range?: PlanRange
  status?: PlanStatus
  page?: number
  pageSize?: number
}

export interface IPlanState {
  items: IPlan[]
  selected: IPlan | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryPlanDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreatePlanDto) => Promise<void>
  update: (dto: IUpdatePlanDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: IPlan | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
