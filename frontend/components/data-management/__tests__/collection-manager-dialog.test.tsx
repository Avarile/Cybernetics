import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const collections = [
  { name: 'products', displayName: 'Products', fields: [{ name: 'a', type: 'string' }] },
  { name: 'orders', displayName: 'Orders', fields: [{ name: 'b', type: 'string' }] },
]
const remove = vi.fn().mockResolvedValue(undefined)
const setCollection = vi.fn()

vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections }),
}))
vi.mock('@/lib/hooks/use-collection-mutations', () => ({ useCollectionMutations: () => ({ remove }) }))
vi.mock('@/lib/hooks/use-collection-definition', () => ({ useCollectionDefinition: () => ({ definition: null, fields: [] }) }))
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) =>
    sel({
      collectionPanel: { kind: 'list' },
      openCreateCollection: vi.fn(),
      openEditCollection: vi.fn(),
      closeCollectionPanel: vi.fn(),
      collection: 'products',
      setCollection,
    }),
}))
import { CollectionManagerDialog } from '@/components/data-management/collection-manager-dialog'

describe('CollectionManagerDialog', () => {
  it('lists collections with a New button', () => {
    render(<CollectionManagerDialog />)
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new collection/i })).toBeInTheDocument()
  })

  it('re-homes the active collection after deleting it', async () => {
    render(<CollectionManagerDialog />)
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i })
    fireEvent.click(deleteButtons[0]) // opens the confirm dialog for "products" (first row, the active collection)
    const confirm = await screen.findByRole('button', { name: /^delete$/i, hidden: false })
    fireEvent.click(confirm)
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('products'))
    await vi.waitFor(() => expect(setCollection).toHaveBeenCalledWith('orders'))
  })
})
