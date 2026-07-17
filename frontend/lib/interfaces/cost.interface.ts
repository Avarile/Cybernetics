import type { IRelationRef } from './shared.interface'

export type Currency = 'USD' | 'EUR' | 'JPY' | 'AUD' | 'CNY' | 'NZD'
export type CostType = 'food' | 'clothing' | 'rent&mortgage' | 'insurance' | 'education' | 'work' | 'utility' | 'entertainment' | 'emergency' | 'investment' | 'sports' | 'social' | 'transportation' | 'other'

export interface ICost {
  id: number
  slug: string
  name: string
  description?: string | null
  currency: Currency
  amount: string
  invoiceId: string
  type: CostType
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateCostDto {
  name: string
  description?: string | null
  currency: Currency
  amount: string
  invoiceId: string
  type: CostType
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IUpdateCostDto {
  id: number
  name?: string
  description?: string | null
  currency?: Currency
  amount?: string
  invoiceId?: string
  type?: CostType
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IDeleteCostDto {
  id: number
}

export interface IQueryCostDto {
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  name?: string
  description?: string
  currency?: Currency
  amount?: string
  invoiceId?: string
  type?: CostType
  page?: number
  pageSize?: number
}

export interface ICostState {
  items: ICost[]
  selected: ICost | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryCostDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateCostDto) => Promise<void>
  update: (dto: IUpdateCostDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: ICost | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
