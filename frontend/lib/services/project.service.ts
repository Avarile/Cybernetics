import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  IProject,
  ICreateProjectDto,
  IUpdateProjectDto,
  IDeleteProjectDto,
  IQueryProjectDto,
} from '@/lib/interfaces/project.interface'

export const projectService = {
  create(dto: ICreateProjectDto): Promise<IApiResponse<IProject>> {
    return apiClient.post<IApiResponse<IProject>>('/projects/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateProjectDto): Promise<IApiResponse<IProject>> {
    return apiClient.post<IApiResponse<IProject>>('/projects/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteProjectDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/projects/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryProjectDto): Promise<IApiResponse<IProject[]>> {
    return apiClient.post<IApiResponse<IProject[]>>('/projects/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<IProject>> {
    return apiClient.get<IApiResponse<IProject>>(`/projects/${id}`).then((r) => r.data)
  },
  getByName(name: string): Promise<IApiResponse<IProject>> {
    return apiClient.get<IApiResponse<IProject>>(`/projects/name/${encodeURIComponent(name)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<IProject>> {
    return apiClient.get<IApiResponse<IProject>>(`/projects/slug/${slug}`).then((r) => r.data)
  },
  fetchAll(): Promise<IApiResponse<IProject[]>> {
    return apiClient.post<IApiResponse<IProject[]>>('/projects/all', {}).then((r) => r.data)
  },
}
