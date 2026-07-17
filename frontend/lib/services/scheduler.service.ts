import { apiClient } from '@/lib/http/api-client'
import type { IApiResponse } from '@/lib/interfaces/auth.interface'
import type {
  ISchedulerJob,
  IJobNameConfig,
  IQuerySchedulerDto,
  IEnqueueJobDto,
  ICancelJobDto,
} from '@/lib/interfaces/scheduler.interface'

export const schedulerService = {
  query(dto: IQuerySchedulerDto): Promise<IApiResponse<ISchedulerJob[]>> {
    return apiClient.post<IApiResponse<ISchedulerJob[]>>('/scheduler/query', dto).then((r) => r.data)
  },
  enqueue(dto: IEnqueueJobDto): Promise<IApiResponse<ISchedulerJob>> {
    return apiClient.post<IApiResponse<ISchedulerJob>>('/scheduler/enqueue', dto).then((r) => r.data)
  },
  cancel(dto: ICancelJobDto): Promise<IApiResponse<{ cancelled: boolean }>> {
    return apiClient.post<IApiResponse<{ cancelled: boolean }>>('/scheduler/cancel', dto).then((r) => r.data)
  },
  getConfigs(): Promise<IApiResponse<IJobNameConfig[]>> {
    return apiClient.get<IApiResponse<IJobNameConfig[]>>('/scheduler/configs').then((r) => r.data)
  },
}
