import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections: [{ name: 'products', displayName: 'Products', fields: [{ name: 'a', type: 'string' }] }] }),
}))
vi.mock('@/lib/hooks/use-collection-mutations', () => ({ useCollectionMutations: () => ({ remove: vi.fn() }) }))
vi.mock('@/lib/hooks/use-collection-definition', () => ({ useCollectionDefinition: () => ({ definition: null, fields: [] }) }))
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ collectionPanel: { kind: 'list' }, openCreateCollection: vi.fn(), openEditCollection: vi.fn(), closeCollectionPanel: vi.fn() }),
}))
import { CollectionManagerDialog } from '@/components/data-management/collection-manager-dialog'

describe('CollectionManagerDialog', () => {
  it('lists collections with a New button', () => {
    render(<CollectionManagerDialog />)
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new collection/i })).toBeInTheDocument()
  })
})
