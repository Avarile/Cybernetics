import useSWR from 'swr'
import { recordService } from '@/lib/services/record.service'
import { useCollection, useRecordQuery } from '@/lib/state-management/data-management.store'
import type { SearchResults } from '@/lib/interfaces/search.interface'

/**
 * Records for the active collection + query. POST-based, so it uses an explicit
 * fetcher (the global GET fetcher does not apply). `keepPreviousData` avoids a
 * flash to empty while paginating/filtering.
 */
export function useRecords() {
  const collection = useCollection()
  const query = useRecordQuery()
  const key = collection ? (['records', collection, query] as const) : null

  const { data, isLoading, isValidating, error, mutate } = useSWR<SearchResults>(
    key,
    () => recordService.query(collection as string, query),
    { keepPreviousData: true },
  )
  return { results: data, isLoading, isValidating, error, mutate }
}
