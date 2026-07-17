import type { IRelationRef } from './shared.interface'

export type ProjectType = 'personal' | 'work' | 'volunteer' | 'business' | 'not_defined'
export type ProjectStatus = 'not_started' | 'in_progress' | 'testing' | 'completed' | 'cancelled' | 'no_show' | 'on_hold'

export interface IProject {
  id: number
  slug: string
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type: ProjectType
  status: ProjectStatus
  stage?: string | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateProjectDto {
  name: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type: ProjectType
  status: ProjectStatus
  stage?: string | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
}

export interface IUpdateProjectDto {
  id: number
  name?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type?: ProjectType
  status?: ProjectStatus
  stage?: string | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteProjectDto {
  id: number
}

export interface IQueryProjectDto {
  name?: string
  description?: string | null
  startDate?: string | null
  endDate?: string | null
  type?: ProjectType
  status?: ProjectStatus
  stage?: string | null
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface IProjectState {
  items: IProject[]
  selected: IProject | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryProjectDto) => Promise<void>
  fetchAllForGraph: () => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateProjectDto) => Promise<void>
  update: (dto: IUpdateProjectDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: IProject | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
