import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const setCollection = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/dashboard/data-management',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: () => true }))
vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections: [{ name: 'products', displayName: 'Products', fields: [] }], isLoading: false }),
}))
vi.mock('@/lib/hooks/use-collection-definition', () => ({
  useCollectionDefinition: () => ({ definition: null, fields: [{ name: 'title', type: 'string' }], isLoading: false }),
}))
vi.mock('@/lib/hooks/use-records', () => ({
  useRecords: () => ({ results: { hits: [], page: 1, limit: 20, totalHits: 0, totalPages: 0, processingTimeMs: 1 }, isLoading: false, error: undefined, mutate: vi.fn() }),
}))
vi.mock('@/lib/state-management/data-management.store', async (orig) => {
  const actual = await orig<typeof import('@/lib/state-management/data-management.store')>()
  return { ...actual, useCollection: () => null, useSetCollection: () => setCollection }
})

import { DataManagementView } from '@/components/data-management/data-management-view'

beforeEach(() => vi.clearAllMocks())

describe('DataManagementView', () => {
  it('renders the heading and defaults to the first collection', async () => {
    render(<DataManagementView />)
    expect(screen.getByRole('heading', { name: /data management/i })).toBeInTheDocument()
    await waitFor(() => expect(setCollection).toHaveBeenCalledWith('products'))
  })
})
