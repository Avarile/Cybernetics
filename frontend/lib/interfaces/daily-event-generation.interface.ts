export interface IConversationMessage {
  role: 'user' | 'assistant'
  text: string
  timestamp: string
}

export interface IDailyEventGeneration {
  id: number
  slug: string
  dailySummaryID: number | null
  eventID: number | null
  context: IConversationMessage[] | null
  isActive: boolean
  isDeleted: boolean
  createdAt: string
  updatedAt: string | null
}

export interface ICreateDailyEventGenerationDto {
  dailySummaryID: number
  eventID: number
  messages: IConversationMessage[]
}

export interface IQueryDailyEventGenerationDto {
  dailySummaryID?: number
  eventID?: number
  page?: number
  pageSize?: number
  isDeleted?: boolean
}

export interface IDeleteDailyEventGenerationDto {
  id: number
}

export interface IDailyEventGenerationState {
  currentEventContext: IConversationMessage[] | null
  isLoading: boolean
  error: string | null
  fetchByEvent: (dailySummaryID: number, eventID: number) => Promise<void>
  clearCurrentEventContext: () => void
  clearError: () => void
}
