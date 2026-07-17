import { apiClient } from '@/lib/http/api-client'
import type {
  IAgent,
  IThread,
  IThreadsPayload,
  IThreadMessagesPayload,
  IInitSessionPayload,
  IContinueSessionPayload,
  IRawThreadMessage,
} from '@/lib/interfaces/mastra.interface'

// The axios response interceptor unwraps { status:'success', payload } → { data: payload, message }.
// For the threads endpoint the payload shape is IThreadsPayload, not IThread[] directly.

type BaseResponse<T> = { data: T; message: string; status_code: number }

export const mastraService = {
  getAgents(): Promise<Record<string, IAgent>> {
    return apiClient
      .get<BaseResponse<Record<string, IAgent>>>('/mastra/agents')
      .then((r) => r.data.data)
  },

  getThreads(): Promise<IThread[]> {
    return apiClient
      .get<BaseResponse<IThreadsPayload>>('/mastra/threads')
      .then((r) => r.data.data?.threads ?? [])
  },

  getThreadMessages(agentId: string, threadId: string): Promise<IRawThreadMessage[]> {
    return apiClient
      .get<BaseResponse<IThreadMessagesPayload>>(
        `/mastra/agents/${agentId}/threads/${threadId}`,
      )
      .then((r) => r.data.data?.messages ?? [])
  },

  initiateSession(
    agentId: string,
    message: string,
    threadId: string,
    opts?: { dailySummaryID?: number; eventID?: number; taskId?: number },
  ): Promise<IInitSessionPayload> {
    return apiClient
      .post<BaseResponse<IInitSessionPayload>>(
        `/mastra/agents/${agentId}/initiate-session`,
        { message, threadId, ...opts },
      )
      .then((r) => r.data.data)
  },

  continueSession(
    agentId: string,
    threadId: string,
    message: string,
    opts?: { dailySummaryID?: number; eventID?: number; taskId?: number },
  ): Promise<IContinueSessionPayload> {
    return apiClient
      .post<BaseResponse<IContinueSessionPayload>>(
        `/mastra/agents/${agentId}/${threadId}/continue-session`,
        { message, ...opts },
      )
      .then((r) => r.data.data)
  },

  deleteThread(agentId: string, threadId: string): Promise<{ result: string }> {
    return apiClient
      .delete<BaseResponse<{ result: string }>>(
        `/mastra/agents/${agentId}/threads/${threadId}`,
      )
      .then((r) => r.data.data)
  },
}
