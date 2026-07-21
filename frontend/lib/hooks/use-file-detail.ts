'use client'
import useSWR from 'swr'
import { fileService } from '@/lib/services/file.service'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

export function useFileDetail(id: string | null) {
  const { data, isLoading, error, mutate } = useSWR<FileMetadata>(
    id ? ['file', id] : null,
    () => fileService.get(id as string),
  )
  return { file: data, isLoading, error, mutate }
}
