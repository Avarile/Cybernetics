import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type { IPaginatedApiResponse } from '@/lib/interfaces/shared.interface'
import type {
  IDailyEventGeneration,
  ICreateDailyEventGenerationDto,
  IQueryDailyEventGenerationDto,
  IDeleteDailyEventGenerationDto,
} from '@/lib/interfaces/daily-event-generation.interface'

export const dailyEventGenerationService = {
  create(dto: ICreateDailyEventGenerationDto): Promise<IApiResponse<IDailyEventGeneration>> {
    return apiClient
      .post<IApiResponse<IDailyEventGeneration>>('/daily-event-generation/create', dto)
      .then((r) => r.data)
  },
  search(dto: IQueryDailyEventGenerationDto): Promise<IPaginatedApiResponse<IDailyEventGeneration[]>> {
    return apiClient
      .post<IPaginatedApiResponse<IDailyEventGeneration[]>>('/daily-event-generation/search', dto)
      .then((r) => r.data)
  },
  remove(dto: IDeleteDailyEventGenerationDto): Promise<IApiResponse<void>> {
    return apiClient
      .post<IApiResponse<void>>('/daily-event-generation/delete', dto)
      .then((r) => r.data)
  },
  getByEvent(dailySummaryID: number, eventID: number): Promise<IApiResponse<IDailyEventGeneration | null>> {
    return apiClient
      .get<IApiResponse<IDailyEventGeneration | null>>(
        `/daily-event-generation/event/${dailySummaryID}/${eventID}`,
      )
      .then((r) => r.data)
  },
}
