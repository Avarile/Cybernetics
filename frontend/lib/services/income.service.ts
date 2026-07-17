import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  IIncome,
  ICreateIncomeDto,
  IUpdateIncomeDto,
  IDeleteIncomeDto,
  IQueryIncomeDto,
} from '@/lib/interfaces/income.interface'

export const incomeService = {
  create(dto: ICreateIncomeDto): Promise<IApiResponse<IIncome>> {
    return apiClient.post<IApiResponse<IIncome>>('/incomes/create', dto).then((r) => r.data)
  },
  update(dto: IUpdateIncomeDto): Promise<IApiResponse<IIncome>> {
    return apiClient.post<IApiResponse<IIncome>>('/incomes/update', dto).then((r) => r.data)
  },
  remove(dto: IDeleteIncomeDto): Promise<IApiResponse<void>> {
    return apiClient.post<IApiResponse<void>>('/incomes/delete', dto).then((r) => r.data)
  },
  search(dto: IQueryIncomeDto): Promise<IApiResponse<IIncome[]>> {
    return apiClient.post<IApiResponse<IIncome[]>>('/incomes/search', dto).then((r) => r.data)
  },
  getById(id: number): Promise<IApiResponse<IIncome>> {
    return apiClient.get<IApiResponse<IIncome>>(`/incomes/${id}`).then((r) => r.data)
  },
  getByName(name: string): Promise<IApiResponse<IIncome>> {
    return apiClient.get<IApiResponse<IIncome>>(`/incomes/name/${encodeURIComponent(name)}`).then((r) => r.data)
  },
  getByInvoice(invoiceId: string): Promise<IApiResponse<IIncome[]>> {
    return apiClient.get<IApiResponse<IIncome[]>>(`/incomes/invoice/${encodeURIComponent(invoiceId)}`).then((r) => r.data)
  },
  getBySlug(slug: string): Promise<IApiResponse<IIncome>> {
    return apiClient.get<IApiResponse<IIncome>>(`/incomes/slug/${slug}`).then((r) => r.data)
  },
}
