import type { IRelationRef } from './shared.interface'

export interface IEmail {
  id: number
  slug: string
  gmailMessageId?: string | null
  gmailThreadId?: string | null
  emailDate?: string | null
  title?: string | null
  content?: string | null
  senderEmail: string
  senderName?: string | null
  toRecipients?: unknown[] | null
  ccRecipients?: unknown[] | null
  bccRecipients?: unknown[] | null
  attachments?: unknown[] | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateEmailDto {
  gmailMessageId?: string | null
  gmailThreadId?: string | null
  emailDate?: string | null
  title?: string | null
  content?: string | null
  senderEmail: string
  senderName?: string | null
  toRecipients?: unknown[] | null
  ccRecipients?: unknown[] | null
  bccRecipients?: unknown[] | null
  attachments?: unknown[] | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
}

export interface IUpdateEmailDto {
  id: number
  gmailMessageId?: string | null
  gmailThreadId?: string | null
  emailDate?: string | null
  title?: string | null
  content?: string | null
  senderEmail?: string
  senderName?: string | null
  toRecipients?: unknown[] | null
  ccRecipients?: unknown[] | null
  bccRecipients?: unknown[] | null
  attachments?: unknown[] | null
  contactsInvolved?: IRelationRef[] | null
  knowledgeInvolved?: IRelationRef[] | null
  projectsInvolved?: IRelationRef[] | null
  taskInvolved?: IRelationRef[] | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteEmailDto {
  id: number
}

export interface IQueryEmailDto {
  title?: string | null
  content?: string | null
  senderEmail?: string
  senderName?: string | null
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface IEmailState {
  items: IEmail[]
  selected: IEmail | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryEmailDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateEmailDto) => Promise<void>
  update: (dto: IUpdateEmailDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: IEmail | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
