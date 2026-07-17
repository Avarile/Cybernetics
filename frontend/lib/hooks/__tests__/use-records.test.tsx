import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'

vi.mock('@/lib/services/record.service', () => ({
  recordService: { query: vi.fn() },
}))

import { recordService } from '@/lib/services/record.service'
import { useRecords } from '@/lib/hooks/use-records'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => {
  vi.clearAllMocks()
  useDataManagementStore.setState({ collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [] })
})

describe('useRecords', () => {
  it('fetches records for the active collection + query', async () => {
    vi.mocked(recordService.query).mockResolvedValue({ hits: [{ id: 'r1' }], page: 1, limit: 20, totalHits: 1, totalPages: 1, processingTimeMs: 1 })
    const { result } = renderHook(() => useRecords(), { wrapper })
    await waitFor(() => expect(result.current.results?.totalHits).toBe(1))
    expect(recordService.query).toHaveBeenCalledWith('products', expect.objectContaining({ page: 1, limit: 20 }))
  })
})
