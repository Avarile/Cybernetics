import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: () => true }))
vi.mock('@/lib/hooks/use-collections', () => ({
  useCollections: () => ({ collections: [{ name: 'products', displayName: 'Products', fields: [] }], isLoading: false }),
}))

import { RecordToolbar } from '@/components/data-management/record-toolbar'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [{ name: 'status', type: 'string', enum: ['active'], filterable: true }]

beforeEach(() => {
  useDataManagementStore.setState({ collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [], selection: {}, panel: 'closed' })
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
})
