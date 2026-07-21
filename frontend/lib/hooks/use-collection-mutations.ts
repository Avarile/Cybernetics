'use client'
import { useCallback } from 'react'
import { useSWRConfig } from 'swr'
import { toast } from 'sonner'
import { collectionService } from '@/lib/services/collection.service'
import type { CreateCollectionInput, UpdateCollectionInput } from '@/lib/interfaces/search.interface'

export function useCollectionMutations() {
  const { mutate } = useSWRConfig()
  const refreshList = useCallback(() => mutate('/search/collections'), [mutate])

  const create = useCallback(async (input: CreateCollectionInput) => {
    const view = await collectionService.create(input)
    await refreshList()
    toast.success(`Collection "${view.displayName}" created`)
    return view
  }, [refreshList])

  const update = useCallback(async (name: string, patch: UpdateCollectionInput) => {
    const view = await collectionService.update(name, patch)
    await Promise.all([refreshList(), mutate(`/search/collections/${encodeURIComponent(name)}`)])
    toast.success('Collection updated')
    return view
  }, [refreshList, mutate])

  const remove = useCallback(async (name: string) => {
    await collectionService.remove(name)
    await refreshList()
    toast.success('Collection deleted')
  }, [refreshList])

  return { create, update, remove }
}
