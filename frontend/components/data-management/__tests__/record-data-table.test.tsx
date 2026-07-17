import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: () => true }))

import { RecordDataTable } from '@/components/data-management/record-data-table'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec, SearchResults } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [{ name: 'title', type: 'string' }, { name: 'price', type: 'number', sortable: true }]

beforeEach(() => {
  useDataManagementStore.setState({ collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [], selection: {}, columnVisibility: {} })
})

describe('RecordDataTable', () => {
  it('renders rows from results', () => {
    const results: SearchResults = { hits: [{ id: 'r1', title: 'Laptop', price: 999 }], page: 1, limit: 20, totalHits: 1, totalPages: 1, processingTimeMs: 1 }
    render(<RecordDataTable fields={fields} results={results} isLoading={false} onRetry={() => {}} />)
    expect(screen.getByText('Laptop')).toBeInTheDocument()
    expect(screen.getByText('1 record(s)')).toBeInTheDocument()
  })

  it('shows an empty state when there are no hits', () => {
    const results: SearchResults = { hits: [], page: 1, limit: 20, totalHits: 0, totalPages: 0, processingTimeMs: 1 }
    render(<RecordDataTable fields={fields} results={results} isLoading={false} onRetry={() => {}} />)
    expect(screen.getByText('No records')).toBeInTheDocument()
  })

  it('shows an error state with retry', () => {
    render(<RecordDataTable fields={fields} results={undefined} isLoading={false} error={new Error('x')} onRetry={() => {}} />)
    expect(screen.getByText('Could not load records')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
