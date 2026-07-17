import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  IContact,
  ICreateContactDto,
  IUpdateContactDto,
  IDeleteContactDto,
  IQueryContactDto,
} from '@/lib/interfaces/contact.interface'

export const contactService = {
  create(dto: ICreateContactDto): Promise<IApiResponse<IContact>> {
    return apiClient.post<IApiResponse<IContact>>('/contacts/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateContactDto): Promise<IApiResponse<IContact>> {
    return apiClient.post<IApiResponse<IContact>>('/contacts/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteContactDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/contacts/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryContactDto): Promise<IApiResponse<IContact[]>> {
    return apiClient.post<IApiResponse<IContact[]>>('/contacts/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<IContact>> {
    return apiClient.get<IApiResponse<IContact>>(`/contacts/${id}`).then((r) => r.data)
  },
  getByEmail(email: string): Promise<IApiResponse<IContact>> {
    return apiClient.get<IApiResponse<IContact>>(`/contacts/email/${encodeURIComponent(email)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<IContact>> {
    return apiClient.get<IApiResponse<IContact>>(`/contacts/slug/${slug}`).then((r) => r.data)
  },
  getByMobile(mobile: string): Promise<IApiResponse<IContact>> {
    return apiClient.get<IApiResponse<IContact>>(`/contacts/mobile/${encodeURIComponent(mobile)}`).then((r) => r.data)
  },
}
