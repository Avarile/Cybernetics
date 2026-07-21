import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

const replace = vi.fn()
const searchParams = vi.fn(() => new URLSearchParams('collection=products&record=abc&q=laptop'))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard/data-management',
  useSearchParams: () => searchParams(),
}))
const actions = { setCollection: vi.fn(), setSearch: vi.fn(), setPage: vi.fn(), toggleSort: vi.fn(), openDetail: vi.fn() }
const storeState = { ...actions, collection: null, q: '', page: 1, sort: [], detailId: null }
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) => sel(storeState),
}))
import { useQueryUrlSync } from '@/lib/hooks/use-query-url-sync'

describe('useQueryUrlSync', () => {
  beforeEach(() => {
    replace.mockClear()
    for (const fn of Object.values(actions)) fn.mockClear()
    searchParams.mockReturnValue(new URLSearchParams('collection=products&record=abc&q=laptop'))
  })

  it('hydrates collection, search, and record from the URL on mount', () => {
    renderHook(() => useQueryUrlSync())
    expect(actions.setCollection).toHaveBeenCalledWith('products')
    expect(actions.setSearch).toHaveBeenCalledWith('laptop')
    expect(actions.openDetail).toHaveBeenCalledWith('abc')
  })

  it('never strips deep-link params from the URL on the mount commit', () => {
    // Regression test for the write-back effect running with a stale
    // (pre-hydration) store closure in the same commit as the hydration
    // effect, which used to call router.replace(pathname) with an empty
    // querystring and strip ?record=abc before the hydrated state landed.
    searchParams.mockReturnValue(new URLSearchParams('record=abc'))
    renderHook(() => useQueryUrlSync())
    for (const [url] of replace.mock.calls) {
      expect(url).toContain('record=abc')
    }
  })
})
