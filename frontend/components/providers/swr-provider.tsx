'use client'

import { SWRConfig } from 'swr'
import { swrFetcher } from '@/lib/hooks/swr-fetcher'

export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ fetcher: swrFetcher, revalidateOnFocus: false, shouldRetryOnError: false }}>
      {children}
    </SWRConfig>
  )
}
