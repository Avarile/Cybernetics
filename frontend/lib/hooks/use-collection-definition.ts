import useSWR from 'swr'
import type { CollectionView, FieldSpec } from '@/lib/interfaces/search.interface'

export function useCollectionDefinition(name: string | null) {
  const { data, isLoading, error } = useSWR<CollectionView>(
    name ? `/search/collections/${encodeURIComponent(name)}` : null,
  )
  return {
    definition: data ?? null,
    fields: (data?.fields ?? []) as FieldSpec[],
    isLoading,
    error,
  }
}
