import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  IPlan,
  ICreatePlanDto,
  IUpdatePlanDto,
  IDeletePlanDto,
  IQueryPlanDto,
  PlanStatus,
} from '@/lib/interfaces/plan.interface'

export const planService = {
  create(dto: ICreatePlanDto): Promise<IApiResponse<IPlan>> {
    return apiClient.post<IApiResponse<IPlan>>('/plans/create', dto).then((r) => r.data)
  },
  update(dto: IUpdatePlanDto): Promise<IApiResponse<IPlan>> {
    return apiClient.post<IApiResponse<IPlan>>('/plans/update', dto).then((r) => r.data)
  },
  remove(dto: IDeletePlanDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/plans/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryPlanDto): Promise<IApiResponse<IPlan[]>> {
    return apiClient.post<IApiResponse<IPlan[]>>('/plans/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<IPlan>> {
    return apiClient.get<IApiResponse<IPlan>>(`/plans/${id}`).then((r) => r.data)
  },
  getByName(name: string): Promise<IApiResponse<IPlan>> {
    return apiClient.get<IApiResponse<IPlan>>(`/plans/name/${encodeURIComponent(name)}`).then((r) => r.data)
  },
  getByStatus(status: PlanStatus): Promise<IApiResponse<IPlan[]>> {
    return apiClient.get<IApiResponse<IPlan[]>>(`/plans/status/${status}`).then((r) => r.data)
  },
}
