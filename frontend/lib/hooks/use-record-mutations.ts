'use client'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { recordService } from '@/lib/services/record.service'
import { useCollection, useDataManagementStore } from '@/lib/state-management/data-management.store'
import { useRecords } from '@/lib/hooks/use-records'
import type { PersistRecordInput, SearchResults } from '@/lib/interfaces/search.interface'

const REVALIDATE_DELAYS_MS = [900, 2500] // bounded catch-up while Meili indexes

export function useRecordMutations() {
  const collection = useCollection()
  const openDetail = useDataManagementStore((s) => s.openDetail)
  const { mutate } = useRecords()

  const revalidateSoon = useCallback(() => {
    for (const d of REVALIDATE_DELAYS_MS) setTimeout(() => void mutate(), d)
  }, [mutate])

  const create = useCallback(
    async (input: PersistRecordInput) => {
      if (!collection) throw new Error('No collection selected')
      const [res] = await recordService.persist(collection, [input])
      if (res) {
        toast.success('Record queued for indexing', {
          description: 'View it now to watch indexing complete.',
          action: { label: 'View', onClick: () => openDetail(res.id) },
        })
      }
      revalidateSoon()
      return res
    },
    [collection, openDetail, revalidateSoon],
  )

  const remove = useCallback(
    async (ids: string[]) => {
      if (!collection) throw new Error('No collection selected')
      await Promise.all(ids.map((id) => recordService.remove(collection, id)))
      toast.success(`${ids.length} record(s) deleted`)
      await mutate(
        (prev?: SearchResults) =>
          prev
            ? { ...prev, hits: prev.hits.filter((h) => !ids.includes(h.id)), totalHits: Math.max(0, prev.totalHits - ids.length) }
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
