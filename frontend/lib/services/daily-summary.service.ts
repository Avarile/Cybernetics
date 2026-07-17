import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  IDailySummary,
  ICreateDailySummaryDto,
  IUpdateDailySummaryDto,
  IUpdateDailySummaryEventsDto,
  IUpsertTodayEventsDto,
  IDeleteDailySummaryDto,
  IQueryDailySummaryDto,
} from '@/lib/interfaces/daily-summary.interface'

export const dailySummaryService = {
  create(dto: ICreateDailySummaryDto): Promise<IApiResponse<IDailySummary>> {
    return apiClient.post<IApiResponse<IDailySummary>>('/daily-summary/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateDailySummaryDto): Promise<IApiResponse<IDailySummary>> {
    return apiClient.post<IApiResponse<IDailySummary>>('/daily-summary/update', dto).then((r) => r.data)
  },
  updateEvents(dto: IUpdateDailySummaryEventsDto): Promise<IApiResponse<IDailySummary>> {
    return apiClient.post<IApiResponse<IDailySummary>>('/daily-summary/update-events', dto).then((r) => r.data)
  },
  upsertTodayEvents(dto: IUpsertTodayEventsDto): Promise<IApiResponse<IDailySummary>> {
    return apiClient.post<IApiResponse<IDailySummary>>('/daily-summary/upsert-today-events', dto).then((r) => r.data)
  },
  remove(dto: IDeleteDailySummaryDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/daily-summary/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryDailySummaryDto): Promise<IApiResponse<IDailySummary[]>> {
    return apiClient.post<IApiResponse<IDailySummary[]>>('/daily-summary/search', dto).then((r) => r.data)
  },
  getToday(): Promise<IApiResponse<IDailySummary>> {
    return apiClient.get<IApiResponse<IDailySummary>>('/daily-summary/today').then((r) => r.data)
  },
  getLatest(): Promise<IApiResponse<IDailySummary>> {
    return apiClient.get<IApiResponse<IDailySummary>>('/daily-summary/latest').then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<IDailySummary>> {
    return apiClient.get<IApiResponse<IDailySummary>>(`/daily-summary/slug/${slug}`).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<IDailySummary>> {
    return apiClient.get<IApiResponse<IDailySummary>>(`/daily-summary/${id}`).then((r) => r.data)
  },
}
