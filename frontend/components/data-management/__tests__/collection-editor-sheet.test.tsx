import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const create = vi.fn()
const useCollectionDefinition = vi.fn()
vi.mock('@/lib/hooks/use-collection-mutations', () => ({ useCollectionMutations: () => ({ create, update: vi.fn() }) }))
vi.mock('@/lib/hooks/use-collection-definition', () => ({ useCollectionDefinition: (...args: unknown[]) => useCollectionDefinition(...args) }))
import { CollectionEditorSheet } from '@/components/data-management/collection-editor-sheet'

beforeEach(() => {
  vi.clearAllMocks()
  useCollectionDefinition.mockReturnValue({ definition: null, fields: [] })
})

describe('CollectionEditorSheet (create)', () => {
  it('blocks submit when no field is searchable', async () => {
    render(<CollectionEditorSheet open mode="create" onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'products' } })
    fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'Products' } })
    fireEvent.click(screen.getByRole('button', { name: /add field/i }))
    fireEvent.change(screen.getByLabelText('field-name-0'), { target: { value: 'title' } })
    fireEvent.click(screen.getByRole('button', { name: /create collection/i }))
    await waitFor(() => expect(screen.getByText(/at least one field must be searchable/i)).toBeInTheDocument())
    expect(create).not.toHaveBeenCalled()
  })
})

describe('CollectionEditorSheet (edit)', () => {
  it('prefills the form from the loaded definition and locks the name field', () => {
    useCollectionDefinition.mockReturnValue({
      definition: {
        name: 'products',
        displayName: 'Products',
        description: null,
        fields: [{ name: 'title', type: 'string', searchable: true }],
        createdAt: '',
        updatedAt: '',
      },
      fields: [{ name: 'title', type: 'string', searchable: true }],
    })
    render(<CollectionEditorSheet open mode="edit" name="products" onClose={() => {}} />)
    expect(screen.getByLabelText(/display name/i)).toHaveValue('Products')
    expect(screen.getByLabelText(/^name$/i)).toBeDisabled()
  })
})
