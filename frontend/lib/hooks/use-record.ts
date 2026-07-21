import useSWR from 'swr'
import { recordService } from '@/lib/services/record.service'
import type { RecordDetail } from '@/lib/interfaces/search.interface'

/**
 * One record read from Postgres (source of truth). POST-independent, so it uses
 * an explicit fetcher. Polls only while the record is still indexing, then stops.
 */
export function useRecord(collection: string | null, id: string | null) {
  const key = collection && id ? (['record', collection, id] as const) : null
  const { data, isLoading, error, mutate } = useSWR<RecordDetail>(
    key,
    () => recordService.get(collection as string, id as string),
    { refreshInterval: (d?: RecordDetail) => (d?.indexState === 'PENDING' ? 1500 : 0) },
  )
  return { record: data, isLoading, error, mutate }
}
