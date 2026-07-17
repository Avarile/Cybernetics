import type { IRelationRef } from './shared.interface'

export type Currency = 'USD' | 'EUR' | 'JPY' | 'AUD' | 'CNY' | 'NZD'

export interface IIncome {
  id: number
  slug: string
  name: string
  description?: string | null
  currency: Currency
  amount: string
  invoiceId: string
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateIncomeDto {
  name: string
  description?: string | null
  currency: Currency
  amount: string
  invoiceId: string
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IUpdateIncomeDto {
  id: number
  name?: string
  description?: string | null
  currency?: Currency
  amount?: string
  invoiceId?: string
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteIncomeDto {
  id: number
}

export interface IQueryIncomeDto {
  name?: string
  description?: string | null
  currency?: Currency
  invoiceId?: string
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface IIncomeState {
  items: IIncome[]
  selected: IIncome | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryIncomeDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateIncomeDto) => Promise<void>
  update: (dto: IUpdateIncomeDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: IIncome | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
