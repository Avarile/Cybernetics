import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockUseIsAdmin } = vi.hoisted(() => ({ mockUseIsAdmin: vi.fn(() => true) }))
vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: mockUseIsAdmin }))
vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections: [{ name: 'products', displayName: 'Products', fields: [] }], isLoading: false }),
}))

import { RecordToolbar } from '@/components/data-management/record-toolbar'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [{ name: 'status', type: 'string', enum: ['active'], filterable: true }]

beforeEach(() => {
  mockUseIsAdmin.mockReturnValue(true)
  useDataManagementStore.setState({
    collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [], selection: {}, panel: 'closed', uploadOpen: false,
  })
})

describe('RecordToolbar', () => {
  it('admin sees the New record button and opens the create panel', () => {
    render(<RecordToolbar fields={fields} />)
    fireEvent.click(screen.getByRole('button', { name: /new record/i }))
    expect(useDataManagementStore.getState().panel).toBe('create')
  })

  it('shows a bulk-delete button when rows are selected', () => {
    useDataManagementStore.setState({ selection: { r1: true, r2: true } })
    render(<RecordToolbar fields={fields} />)
    expect(screen.getByRole('button', { name: /delete \(2\)/i })).toBeInTheDocument()
  })

  it('has an ungated Upload documents button that opens the upload dialog, even for a non-admin', () => {
    mockUseIsAdmin.mockReturnValue(false)
    render(<RecordToolbar fields={fields} />)

    // Proves it's ungated: admin-only buttons are absent, but Upload documents still renders.
    expect(screen.queryByRole('button', { name: /new record/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /manage/i })).not.toBeInTheDocument()

    const uploadButton = screen.getByRole('button', { name: /upload documents/i })
    fireEvent.click(uploadButton)
    expect(useDataManagementStore.getState().uploadOpen).toBe(true)
  })
})
