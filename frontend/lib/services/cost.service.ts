import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  ICost,
  ICreateCostDto,
  IUpdateCostDto,
  IDeleteCostDto,
  IQueryCostDto,
} from '@/lib/interfaces/cost.interface'

export const costService = {
  create(dto: ICreateCostDto): Promise<IApiResponse<ICost>> {
    return apiClient.post<IApiResponse<ICost>>('/costs/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateCostDto): Promise<IApiResponse<ICost>> {
    return apiClient.post<IApiResponse<ICost>>('/costs/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteCostDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/costs/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryCostDto): Promise<IApiResponse<ICost[]>> {
    return apiClient.post<IApiResponse<ICost[]>>('/costs/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<ICost>> {
    return apiClient.get<IApiResponse<ICost>>(`/costs/${id}`).then((r) => r.data)
  },
  getByName(name: string): Promise<IApiResponse<ICost>> {
    return apiClient.get<IApiResponse<ICost>>(`/costs/name/${encodeURIComponent(name)}`).then((r) => r.data)
  },
  getByInvoice(invoiceId: string): Promise<IApiResponse<ICost[]>> {
    return apiClient.get<IApiResponse<ICost[]>>(`/costs/invoice/${encodeURIComponent(invoiceId)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<ICost>> {
    return apiClient.get<IApiResponse<ICost>>(`/costs/slug/${slug}`).then((r) => r.data)
  },
}
