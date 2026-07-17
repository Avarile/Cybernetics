export type ContactType = 'friend' | 'colleague' | 'client' | 'supervisor' | 'family' | 'loved_one' | 'competitor' | 'collaborator' | 'not_defined'

export interface IContact {
  id: number
  slug: string
  email: string
  firstName: string
  lastName: string
  nickName: string
  title?: string | null
  mobile?: string | null
  position?: string | null
  contactType: ContactType
  address1?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

export interface ICreateContactDto {
  email: string
  firstName: string
  lastName: string
  nickName: string
  title?: string | null
  mobile?: string | null
  position?: string | null
  contactType: ContactType
  address1?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
}

export interface IUpdateContactDto {
  id: number
  email?: string
  firstName?: string
  lastName?: string
  nickName?: string
  title?: string | null
  mobile?: string | null
  position?: string | null
  contactType?: ContactType
  address1?: string | null
  address2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  country?: string | null
  isDeleted?: boolean
  isActive?: boolean
}

export interface IDeleteContactDto {
  id: number
}

export interface IQueryContactDto {
  email?: string
  firstName?: string
  lastName?: string
  nickName?: string
  title?: string | null
  mobile?: string | null
  position?: string | null
  contactType?: ContactType
  id?: number
  ids?: number[]
  slug?: string
  slugs?: string[]
  page?: number
  pageSize?: number
  isActive?: boolean
  isDeleted?: boolean
}

export interface IContactState {
  items: IContact[]
  selected: IContact | null
  isLoading: boolean
  error: string | null
  total: number
  page: number
  pageSize: number
  fetchAll: (query?: IQueryContactDto) => Promise<void>
  fetchById: (id: number) => Promise<void>
  create: (dto: ICreateContactDto) => Promise<void>
  update: (dto: IUpdateContactDto) => Promise<void>
  remove: (id: number) => Promise<void>
  setSelected: (item: IContact | null) => void
  setPage: (page: number) => void
  clearError: () => void
}
