import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  ICompany,
  ICreateCompanyDto,
  IUpdateCompanyDto,
  IDeleteCompanyDto,
  IQueryCompanyDto,
} from '@/lib/interfaces/company.interface'

export const companyService = {
  create(dto: ICreateCompanyDto): Promise<IApiResponse<ICompany>> {
    return apiClient.post<IApiResponse<ICompany>>('/companies/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateCompanyDto): Promise<IApiResponse<ICompany>> {
    return apiClient.post<IApiResponse<ICompany>>('/companies/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteCompanyDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/companies/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryCompanyDto): Promise<IApiResponse<ICompany[]>> {
    return apiClient.post<IApiResponse<ICompany[]>>('/companies/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<ICompany>> {
    return apiClient.get<IApiResponse<ICompany>>(`/companies/${id}`).then((r) => r.data)
  },
  getByName(name: string): Promise<IApiResponse<ICompany>> {
    return apiClient.get<IApiResponse<ICompany>>(`/companies/name/${encodeURIComponent(name)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<ICompany>> {
    return apiClient.get<IApiResponse<ICompany>>(`/companies/slug/${slug}`).then((r) => r.data)
  },
}
