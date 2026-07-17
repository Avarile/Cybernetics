import { apiClient } from '@/lib/http/api-client'

/** Default SWR fetcher — GET through the shared api-client (bearer + refresh). */
export const swrFetcher = <T>(url: string): Promise<T> =>
  apiClient.get<T>(url).then((r) => r.data)
