import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  ICall,
  ICreateCallDto,
  IUpdateCallDto,
  IDeleteCallDto,
  IQueryCallDto,
} from '@/lib/interfaces/call.interface'

export const callService = {
  create(dto: ICreateCallDto): Promise<IApiResponse<ICall>> {
    return apiClient.post<IApiResponse<ICall>>('/calls/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateCallDto): Promise<IApiResponse<ICall>> {
    return apiClient.post<IApiResponse<ICall>>('/calls/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteCallDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/calls/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryCallDto): Promise<IApiResponse<ICall[]>> {
    return apiClient.post<IApiResponse<ICall[]>>('/calls/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<ICall>> {
    return apiClient.get<IApiResponse<ICall>>(`/calls/${id}`).then((r) => r.data)
  },
  getByCallId(callID: string): Promise<IApiResponse<ICall>> {
    return apiClient.get<IApiResponse<ICall>>(`/calls/callID/${callID}`).then((r) => r.data)
  },
  getByStatus(status: string): Promise<IApiResponse<ICall[]>> {
    return apiClient.get<IApiResponse<ICall[]>>(`/calls/status/${status}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<ICall>> {
    return apiClient.get<IApiResponse<ICall>>(`/calls/slug/${slug}`).then((r) => r.data)
  },
}
