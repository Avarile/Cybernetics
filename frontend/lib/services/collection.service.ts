import { apiClient } from '@/lib/http/api-client'
import type { CollectionView } from '@/lib/interfaces/search.interface'

export const collectionService = {
  list(): Promise<CollectionView[]> {
    return apiClient.get<CollectionView[]>('/search/collections').then((r) => r.data)
  },
  get(name: string): Promise<CollectionView> {
    return apiClient
      .get<CollectionView>(`/search/collections/${encodeURIComponent(name)}`)
      .then((r) => r.data)
  },
}
