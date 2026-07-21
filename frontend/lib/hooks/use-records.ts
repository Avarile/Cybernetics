import useSWR from 'swr'
import { recordService } from '@/lib/services/record.service'
import { useCollection, useRecordQuery } from '@/lib/state-management/data-management.store'
import type { FieldSpec, SearchResults } from '@/lib/interfaces/search.interface'

/**
 * Records for the active collection + query. POST-based, so it uses an explicit
 * fetcher (the global GET fetcher does not apply). `keepPreviousData` avoids a
 * flash to empty while paginating/filtering.
 *
 * `fields` drives which fields to facet (filterable + enum) and highlight
 * (searchable). They are stable per collection, so they're deliberately kept
 * out of the SWR key — only `collection` + `query` identify the cache entry.
 */
export function useRecords(fields: FieldSpec[] = []) {
  const collection = useCollection()
  const query = useRecordQuery()
  const facets = fields.filter((f) => f.filterable && f.enum?.length).map((f) => f.name)
  const highlight = fields.filter((f) => f.searchable).map((f) => f.name)
  const key = collection ? (['records', collection, query] as const) : null

  const { data, isLoading, isValidating, error, mutate } = useSWR<SearchResults>(
    key,
    () => recordService.query(collection as string, query, { facets, highlight }),
    { keepPreviousData: true },
  )
  return { results: data, isLoading, isValidating, error, mutate }
}
