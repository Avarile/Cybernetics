import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/lib/services/collection.service', () => ({ collectionService: { create: vi.fn(), update: vi.fn(), remove: vi.fn() } }))
import { collectionService } from '@/lib/services/collection.service'
import { useCollectionMutations } from '@/lib/hooks/use-collection-mutations'

beforeEach(() => vi.clearAllMocks())

describe('useCollectionMutations', () => {
  it('create calls service and revalidates the list', async () => {
    vi.mocked(collectionService.create).mockResolvedValue({ displayName: 'C' } as never)
    const { result } = renderHook(() => useCollectionMutations())
    await act(async () => { await result.current.create({ name: 'c', displayName: 'C', fields: [] }) })
    expect(collectionService.create).toHaveBeenCalled()
    expect(mutate).toHaveBeenCalledWith('/search/collections')
  })

  it('update calls service and revalidates both the list and the item', async () => {
    vi.mocked(collectionService.update).mockResolvedValue({ displayName: 'C2' } as never)
    const { result } = renderHook(() => useCollectionMutations())
    await act(async () => { await result.current.update('c', { displayName: 'C2' }) })
    expect(collectionService.update).toHaveBeenCalledWith('c', { displayName: 'C2' })
    expect(mutate).toHaveBeenCalledWith('/search/collections')
    expect(mutate).toHaveBeenCalledWith('/search/collections/c')
  })

  it('remove calls service and revalidates the list', async () => {
    vi.mocked(collectionService.remove).mockResolvedValue(undefined)
    const { result } = renderHook(() => useCollectionMutations())
    await act(async () => { await result.current.remove('c') })
    expect(collectionService.remove).toHaveBeenCalledWith('c')
    expect(mutate).toHaveBeenCalledWith('/search/collections')
  })
})
