import { apiClient } from '@/lib/http/api-client'
import type { CollectionView, CreateCollectionInput, UpdateCollectionInput } from '@/lib/interfaces/search.interface'

export const collectionService = {
  list(): Promise<CollectionView[]> {
    return apiClient.get<CollectionView[]>('/search/collections').then((r) => r.data)
  },
  get(name: string): Promise<CollectionView> {
    return apiClient
      .get<CollectionView>(`/search/collections/${encodeURIComponent(name)}`)
      .then((r) => r.data)
  },
  create(input: CreateCollectionInput): Promise<CollectionView> {
    return apiClient.post<CollectionView>('/search/collections', input).then((r) => r.data)
  },
  update(name: string, patch: UpdateCollectionInput): Promise<CollectionView> {
    return apiClient
      .patch<CollectionView>(`/search/collections/${encodeURIComponent(name)}`, patch)
      .then((r) => r.data)
  },
  remove(name: string): Promise<void> {
    return apiClient.delete(`/search/collections/${encodeURIComponent(name)}`).then(() => undefined)
  },
}
