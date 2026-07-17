import type { IRelationRef } from './shared.interface'

export type CallStatus = 'failed' | 'voice_mail' | 'completed' | 'no_show'
export type CallOutcome = 'success' | 'failure' | 'follow_up_required' | 'rescheduled' | 'no_outcome'

export interface ICall {
  id: number
  callID?: string | null
  slug: string
  status: CallStatus
  outcome: CallOutcome
  transcript?: string | null
  duration?: number | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateCallDto {
  callID?: string | null
  status: CallStatus
  outcome: CallOutcome
  transcript?: string | null
  duration?: number | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IUpdateCallDto {
  id: number
  callID?: string | null
  status?: CallStatus
  outcome?: CallOutcome
  transcript?: string | null
  duration?: number | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteCallDto {
  id: number
}

export interface IQueryCallDto {
  callID?: string | null
  status?: CallStatus
  outcome?: CallOutcome
  transcript?: string | null
  duration?: number | null
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface ICallState {
  items: ICall[]
  selected: ICall | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryCallDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateCallDto) => Promise<void>
  update: (dto: IUpdateCallDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: ICall | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
