import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  IEvent,
  ICreateEventDto,
  IUpdateEventDto,
  IDeleteEventDto,
  IQueryEventDto,
} from '@/lib/interfaces/event.interface'

export const eventService = {
  create(dto: ICreateEventDto): Promise<IApiResponse<IEvent>> {
    return apiClient.post<IApiResponse<IEvent>>('/events/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateEventDto): Promise<IApiResponse<IEvent>> {
    return apiClient.post<IApiResponse<IEvent>>('/events/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteEventDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/events/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryEventDto): Promise<IApiResponse<IEvent[]>> {
    return apiClient.post<IApiResponse<IEvent[]>>('/events/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<IEvent>> {
    return apiClient.get<IApiResponse<IEvent>>(`/events/${id}`).then((r) => r.data)
  },
  getByName(name: string): Promise<IApiResponse<IEvent>> {
    return apiClient.get<IApiResponse<IEvent>>(`/events/name/${encodeURIComponent(name)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<IEvent>> {
    return apiClient.get<IApiResponse<IEvent>>(`/events/slug/${slug}`).then((r) => r.data)
  },
  getUpcoming(): Promise<IApiResponse<IEvent[]>> {
    return apiClient.get<IApiResponse<IEvent[]>>('/events/upcoming/all').then((r) => r.data)
  },
  getPast(): Promise<IApiResponse<IEvent[]>> {
    return apiClient.get<IApiResponse<IEvent[]>>('/events/past/all').then((r) => r.data)
  },
}
