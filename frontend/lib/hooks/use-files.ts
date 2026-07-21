'use client'
import useSWR from 'swr'
import { fileService } from '@/lib/services/file.service'
import { useFileQuery, useFileManagementStore } from '@/lib/state-management/file-management.store'
import type { FileMetadata, PaginatedFiles } from '@/lib/interfaces/search.interface'

const POLL_MS = 4000

/** Poll while a file is still settling (any PENDING row, or inside the post-upload watch window). */
export function computeRefreshInterval(
  items: FileMetadata[] | undefined,
  watchUntil: number,
  now: number,
): number {
  const settling = (items?.some((f) => f.status === 'PENDING') ?? false) || now < watchUntil
  return settling ? POLL_MS : 0
}

export function useFiles() {
  const query = useFileQuery()
  const { data, isLoading, isValidating, error, mutate } = useSWR<PaginatedFiles>(
    ['files', query],
    () => fileService.list(query),
    {
      keepPreviousData: true,
      refreshInterval: (latest) =>
        computeRefreshInterval(latest?.items, useFileManagementStore.getState().watchUntil, Date.now()),
    },
  )
  return { data, isLoading, isValidating, error, mutate }
}
