import { apiClient } from '@/lib/http/api-client'
import { toSearchRequestBody } from '@/lib/schema/serialize-query'
import type {
  PersistRecordInput,
  PersistResult,
  SearchQuery,
  SearchResults,
} from '@/lib/interfaces/search.interface'

const base = (name: string) => `/search/collections/${encodeURIComponent(name)}`

export const recordService = {
  query(collection: string, query: SearchQuery): Promise<SearchResults> {
    return apiClient
      .post<SearchResults>(`${base(collection)}/query`, toSearchRequestBody(query))
      .then((r) => r.data)
  },
  persist(collection: string, records: PersistRecordInput[]): Promise<PersistResult[]> {
    return apiClient
      .post<PersistResult[]>(`${base(collection)}/records`, { records })
      .then((r) => r.data)
  },
  remove(collection: string, id: string): Promise<void> {
    return apiClient
      .delete(`${base(collection)}/records/${encodeURIComponent(id)}`)
      .then(() => undefined)
  },
  reload(collection: string): Promise<void> {
    return apiClient.post(`${base(collection)}/reload`).then(() => undefined)
  },
}
