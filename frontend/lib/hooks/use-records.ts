import useSWR from 'swr'
import { recordService } from '@/lib/services/record.service'
import { useCollection, useRecordQuery } from '@/lib/state-management/data-management.store'
import { useCollectionDefinition } from '@/lib/hooks/use-collection-definition'
import type { SearchResults } from '@/lib/interfaces/search.interface'

/**
 * Records for the active collection + query. Facets (filterable enum fields) and
 * highlight (searchable fields) are derived from the collection definition INSIDE
 * this hook, so every subscriber to the records key uses an IDENTICAL fetcher — no
 * divergent empty-fields fetcher can win SWR's revalidator[0] slot. They are also
 * part of the SWR key, so when the definition resolves ([] -> [...]) the query
 * refetches with the correct facets/highlight. keepPreviousData avoids a flash.
 */
export function useRecords() {
  const collection = useCollection()
  const query = useRecordQuery()
  const { fields } = useCollectionDefinition(collection)
  const facets = fields.filter((f) => f.filterable && f.enum?.length).map((f) => f.name)
  const highlight = fields.filter((f) => f.searchable).map((f) => f.name)
  const key = collection ? (['records', collection, query, facets, highlight] as const) : null

  const { data, isLoading, isValidating, error, mutate } = useSWR<SearchResults>(
    key,
    () => recordService.query(collection as string, query, { facets, highlight }),
    { keepPreviousData: true },
  )
  return { results: data, isLoading, isValidating, error, mutate }
}
