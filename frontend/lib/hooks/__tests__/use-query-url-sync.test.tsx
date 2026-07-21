import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard/data-management',
  useSearchParams: () => new URLSearchParams('collection=products&record=abc&q=laptop'),
}))
const actions = { setCollection: vi.fn(), setSearch: vi.fn(), setPage: vi.fn(), toggleSort: vi.fn(), openDetail: vi.fn() }
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ ...actions, collection: null, q: '', page: 1, sort: [], detailId: null }),
}))
import { useQueryUrlSync } from '@/lib/hooks/use-query-url-sync'

describe('useQueryUrlSync', () => {
  it('hydrates collection, search, and record from the URL on mount', () => {
    renderHook(() => useQueryUrlSync())
    expect(actions.setCollection).toHaveBeenCalledWith('products')
    expect(actions.setSearch).toHaveBeenCalledWith('laptop')
    expect(actions.openDetail).toHaveBeenCalledWith('abc')
  })
})
