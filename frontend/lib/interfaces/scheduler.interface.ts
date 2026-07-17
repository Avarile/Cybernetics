export type JobState = 'waiting' | 'delayed' | 'active' | 'paused'
export type IJobPayload = Record<string, unknown>

export interface ISchedulerJob {
  id:           string | null
  name:         string
  queueName:    string
  status:       JobState
  payload:      IJobPayload
  delay:        number | null
  scheduledAt:  string | null
  processedOn:  string | null
  finishedOn:   string | null
  attemptsMade: number
}

export interface IJobNameConfig {
  queueName: string
  jobNames:  string[]
}

export interface IQuerySchedulerDto {
  queueName: string
  states?:   JobState[]
}

export interface IEnqueueJobDto {
  queueName: string
  jobName:   string
  payload:   IJobPayload
  runAt?:    string    // ISO string
  delayMs?:  number
}

export interface ICancelJobDto {
  queueName: string
  jobId:     string
}

export interface ISchedulerState {
  jobs:           ISchedulerJob[]
  jobNameConfigs: IJobNameConfig[]
  selectedQueue:  string
  isLoading:      boolean
  error:          string | null
  setQueue:       (name: string) => void
  fetchJobs:      (dto?: Partial<IQuerySchedulerDto>) => Promise<void>
  fetchConfigs:   () => Promise<void>
  enqueue:        (dto: IEnqueueJobDto) => Promise<void>
  cancel:         (jobId: string) => Promise<void>
  clearError:     () => void
}
