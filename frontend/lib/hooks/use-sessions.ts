import useSWR from 'swr'
import type { SessionSummary } from '@/lib/interfaces/auth.interface'

export function useSessions() {
  const { data, isLoading, mutate } = useSWR<SessionSummary[]>('/auth/sessions')
  return { sessions: data ?? [], isLoading, mutate }
}
