'use client'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { recordService } from '@/lib/services/record.service'
import { useCollection } from '@/lib/state-management/data-management.store'
import { useRecords } from '@/lib/hooks/use-records'
import type { PersistRecordInput, SearchResults } from '@/lib/interfaces/search.interface'

const REVALIDATE_DELAY_MS = 1200 // async-indexing settle window

export function useRecordMutations() {
  const collection = useCollection()
  const { mutate } = useRecords()

  const revalidateSoon = useCallback(() => {
    setTimeout(() => void mutate(), REVALIDATE_DELAY_MS)
  }, [mutate])

  const create = useCallback(
    async (input: PersistRecordInput) => {
      if (!collection) throw new Error('No collection selected')
      const [res] = await recordService.persist(collection, [input])
      toast.success('Record queued for indexing', {
        description: `Status: ${res?.indexState ?? 'PENDING'} — it will appear shortly.`,
      })
      revalidateSoon()
      return res
    },
    [collection, revalidateSoon],
  )

  const remove = useCallback(
    async (ids: string[]) => {
      if (!collection) throw new Error('No collection selected')
      await Promise.all(ids.map((id) => recordService.remove(collection, id)))
      toast.success(`${ids.length} record(s) deleted`)
      await mutate(
        (prev?: SearchResults) =>
          prev
            ? {
                ...prev,
                hits: prev.hits.filter((h) => !ids.includes(h.id)),
                totalHits: Math.max(0, prev.totalHits - ids.length),
              }
            : prev,
        { revalidate: false },
      )
      revalidateSoon()
    },
    [collection, mutate, revalidateSoon],
  )

  const reindex = useCallback(async () => {
    if (!collection) return
    await recordService.reload(collection)
    toast.info('Reindex started')
    revalidateSoon()
  }, [collection, revalidateSoon])

  return { create, update: create, remove, reindex }
}
