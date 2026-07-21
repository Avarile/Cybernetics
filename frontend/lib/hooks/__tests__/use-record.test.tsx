import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'
import { useRecord } from '@/lib/hooks/use-record'

vi.mock('@/lib/services/record.service', () => ({ recordService: { get: vi.fn() } }))
import { recordService } from '@/lib/services/record.service'

function Probe({ id }: { id: string | null }) {
  const { record, isLoading } = useRecord('products', id)
  if (isLoading) return <span>loading</span>
  return <span>{record ? record.indexState : 'none'}</span>
}
const wrap = (ui: React.ReactNode) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>
)

beforeEach(() => vi.clearAllMocks())

describe('useRecord', () => {
  it('does not fetch when id is null', () => {
    render(wrap(<Probe id={null} />))
    expect(recordService.get).not.toHaveBeenCalled()
    expect(screen.getByText('none')).toBeInTheDocument()
  })
  it('fetches and returns the record', async () => {
    vi.mocked(recordService.get).mockResolvedValue({ id: 'abc', externalId: null, document: {}, indexState: 'INDEXED', createdAt: '', updatedAt: '' })
    render(wrap(<Probe id="abc" />))
    await waitFor(() => expect(screen.getByText('INDEXED')).toBeInTheDocument())
    expect(recordService.get).toHaveBeenCalledWith('products', 'abc')
  })
})
