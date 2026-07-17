import useSWR from 'swr'
import type { CollectionView } from '@/lib/interfaces/search.interface'

export function useCollections() {
  const { data, isLoading, error } = useSWR<CollectionView[]>('/search/collections')
  return { collections: data ?? [], isLoading, error }
}
