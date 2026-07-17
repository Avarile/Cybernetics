// AI Chat Modal module — barrel export
// Provides the Zustand store, typed selector hooks, and shared types
// for the AIConversation component.

export {
  useAIChatStore,
  useAIAgents,
  useAIThreads,
  useAIActiveThread,
  useAIActiveAgent,
  useAIMessages,
  useAIIsSending,
  useAIError,
  useAIIsLoading,
} from './ai-chat'

export type {
  IAIChatState,
  IChatMessage,
  IThread,
  IAgent,
  IRawThreadMessage,
  IInitSessionPayload,
  IContinueSessionPayload,
  ChatRole,
} from '@/lib/interfaces/mastra.interface'
