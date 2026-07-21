'use client'
import { useCallback } from 'react'
import { useSWRConfig } from 'swr'
import { fileService } from '@/lib/services/file.service'

export function useFileMutations() {
  const { mutate } = useSWRConfig()

  const remove = useCallback(
    async (ids: string[]): Promise<{ ok: number; failed: number }> => {
      const results = await Promise.allSettled(ids.map((id) => fileService.remove(id)))
      const ok = results.filter((r) => r.status === 'fulfilled').length
      await mutate((key) => Array.isArray(key) && key[0] === 'files')
      return { ok, failed: results.length - ok }
    },
    [mutate],
  )

  return { remove }
}
