import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/services/record.service', () => ({ recordService: { persist: vi.fn(), remove: vi.fn(), reload: vi.fn() } }))
const mutate = vi.fn()
vi.mock('@/lib/hooks/use-records', () => ({ useRecords: () => ({ mutate }) }))
const openDetail = vi.fn()
vi.mock('@/lib/state-management/data-management.store', () => ({
  useCollection: () => 'products',
  useDataManagementStore: (sel: (s: unknown) => unknown) => sel({ openDetail }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), info: vi.fn() } }))

import { recordService } from '@/lib/services/record.service'
import { toast } from 'sonner'
import { useRecordMutations } from '@/lib/hooks/use-record-mutations'

beforeEach(() => vi.clearAllMocks())

describe('useRecordMutations.create', () => {
  it('persists then wires a View action to the new record id', async () => {
    vi.mocked(recordService.persist).mockResolvedValue([{ id: 'new-1', externalId: 'e', indexState: 'PENDING' }])
    const { result } = renderHook(() => useRecordMutations())
    await act(async () => { await result.current.create({ externalId: 'e', document: { a: 1 } }) })
    expect(recordService.persist).toHaveBeenCalledWith('products', [{ externalId: 'e', document: { a: 1 } }])
    const opts = vi.mocked(toast.success).mock.calls[0][1] as unknown as { action: { onClick: () => void } }
    opts.action.onClick()
    expect(openDetail).toHaveBeenCalledWith('new-1')
  })
})
