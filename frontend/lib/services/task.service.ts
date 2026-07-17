import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  ITask,
  ICreateTaskDto,
  IUpdateTaskDto,
  IDeleteTaskDto,
  IQueryTaskDto,
} from '@/lib/interfaces/task.interface'

export const taskService = {
  create(dto: ICreateTaskDto): Promise<IApiResponse<ITask>> {
    return apiClient.post<IApiResponse<ITask>>('/tasks/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateTaskDto): Promise<IApiResponse<ITask>> {
    return apiClient.post<IApiResponse<ITask>>('/tasks/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteTaskDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/tasks/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryTaskDto): Promise<IApiResponse<ITask[]>> {
    return apiClient.post<IApiResponse<ITask[]>>('/tasks/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<ITask>> {
    return apiClient.get<IApiResponse<ITask>>(`/tasks/${id}`).then((r) => r.data)
  },
  getByName(name: string): Promise<IApiResponse<ITask>> {
    return apiClient.get<IApiResponse<ITask>>(`/tasks/name/${encodeURIComponent(name)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<ITask>> {
    return apiClient.get<IApiResponse<ITask>>(`/tasks/slug/${slug}`).then((r) => r.data)
  },
  fetchAll(): Promise<IApiResponse<ITask[]>> {
    return apiClient.post<IApiResponse<ITask[]>>('/tasks/all', {}).then((r) => r.data)
  },
}
