import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  IEmail,
  ICreateEmailDto,
  IUpdateEmailDto,
  IDeleteEmailDto,
  IQueryEmailDto,
} from '@/lib/interfaces/email.interface'

export const emailService = {
  create(dto: ICreateEmailDto): Promise<IApiResponse<IEmail>> {
    return apiClient.post<IApiResponse<IEmail>>('/emails/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateEmailDto): Promise<IApiResponse<IEmail>> {
    return apiClient.post<IApiResponse<IEmail>>('/emails/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteEmailDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/emails/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryEmailDto): Promise<IApiResponse<IEmail[]>> {
    return apiClient.post<IApiResponse<IEmail[]>>('/emails/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<IEmail>> {
    return apiClient.get<IApiResponse<IEmail>>(`/emails/${id}`).then((r) => r.data)
  },
  getBySender(senderEmail: string): Promise<IApiResponse<IEmail[]>> {
    return apiClient.get<IApiResponse<IEmail[]>>(`/emails/sender/${encodeURIComponent(senderEmail)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<IEmail>> {
    return apiClient.get<IApiResponse<IEmail>>(`/emails/slug/${slug}`).then((r) => r.data)
  },
}
