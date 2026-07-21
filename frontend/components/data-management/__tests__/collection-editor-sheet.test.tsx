import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
const create = vi.fn()
vi.mock('@/lib/hooks/use-collection-mutations', () => ({ useCollectionMutations: () => ({ create, update: vi.fn() }) }))
vi.mock('@/lib/hooks/use-collection-definition', () => ({ useCollectionDefinition: () => ({ definition: null, fields: [] }) }))
import { CollectionEditorSheet } from '@/components/data-management/collection-editor-sheet'

beforeEach(() => vi.clearAllMocks())

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
