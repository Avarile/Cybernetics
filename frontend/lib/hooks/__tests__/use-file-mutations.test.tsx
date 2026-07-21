import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const remove = vi.fn()
vi.mock('@/lib/services/file.service', () => ({ fileService: { remove: (...a: unknown[]) => remove(...a) } }))
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))

import { useFileMutations } from '@/lib/hooks/use-file-mutations'

beforeEach(() => vi.clearAllMocks())

describe('useFileMutations.remove', () => {
  it('reports partial failures and still revalidates', async () => {
    remove.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useFileMutations())
    let res = { ok: 0, failed: 0 }
    await act(async () => { res = await result.current.remove(['a', 'b', 'c']) })
    expect(res).toEqual({ ok: 2, failed: 1 })
    expect(mutate).toHaveBeenCalled()
  })
})
