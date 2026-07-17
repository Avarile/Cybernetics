import type { IRelationRef } from './shared.interface'

export interface ICompany {
  id: number
  name: string
  slug: string
  description?: string | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateCompanyDto {
  name: string
  description?: string | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IUpdateCompanyDto {
  id: number
  name?: string
  description?: string | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteCompanyDto {
  id: number
}

export interface IQueryCompanyDto {
  name?: string
  description?: string | null
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface ICompanyState {
  items: ICompany[]
  selected: ICompany | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryCompanyDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateCompanyDto) => Promise<void>
  update: (dto: IUpdateCompanyDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: ICompany | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
