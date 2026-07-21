import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

  it('reflects the store page against the server page count and advances on next', () => {
    useDataManagementStore.setState({ page: 1, limit: 20 })
    const results: SearchResults = { hits: [{ id: 'r1', title: 'Laptop', price: 999 }], page: 1, limit: 20, totalHits: 45, totalPages: 3, processingTimeMs: 1 }
    render(<RecordDataTable fields={fields} results={results} isLoading={false} onRetry={() => {}} />)

    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /go to next page/i }))
    expect(useDataManagementStore.getState().page).toBe(2)
  })

  it('disables previous/first on the first page and next/last on the last page', () => {
    const results: SearchResults = { hits: [{ id: 'r1', title: 'Laptop', price: 999 }], page: 3, limit: 20, totalHits: 45, totalPages: 3, processingTimeMs: 1 }

    useDataManagementStore.setState({ page: 1, limit: 20 })
    const { rerender } = render(<RecordDataTable fields={fields} results={{ ...results, page: 1 }} isLoading={false} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: /go to previous page/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /go to next page/i })).toBeEnabled()

    useDataManagementStore.setState({ page: 3, limit: 20 })
    rerender(<RecordDataTable fields={fields} results={results} isLoading={false} onRetry={() => {}} />)
    expect(screen.getByRole('button', { name: /go to next page/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /go to previous page/i })).toBeEnabled()
  })

  it('first/last buttons jump to the boundary pages', () => {
    useDataManagementStore.setState({ page: 2, limit: 20 })
    const results: SearchResults = { hits: [{ id: 'r1', title: 'Laptop', price: 999 }], page: 2, limit: 20, totalHits: 45, totalPages: 3, processingTimeMs: 1 }
    render(<RecordDataTable fields={fields} results={results} isLoading={false} onRetry={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /go to last page/i }))
    expect(useDataManagementStore.getState().page).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: /go to first page/i }))
    expect(useDataManagementStore.getState().page).toBe(1)
  })

  it('disables all pagination controls while loading', () => {
    useDataManagementStore.setState({ page: 2, limit: 20 })
    const results: SearchResults = { hits: [{ id: 'r1', title: 'Laptop', price: 999 }], page: 2, limit: 20, totalHits: 45, totalPages: 3, processingTimeMs: 1 }
    render(<RecordDataTable fields={fields} results={results} isLoading={true} onRetry={() => {}} />)

    expect(screen.getByRole('button', { name: /go to next page/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /go to previous page/i })).toBeDisabled()
  })

  it('skeleton row cell count matches the header when a column is hidden', () => {
    useDataManagementStore.setState({ columnVisibility: { price: false } })
    const { container } = render(
      <RecordDataTable fields={fields} results={undefined} isLoading={true} onRetry={() => {}} />,
    )
    const headerCells = container.querySelectorAll('thead th').length
    const firstSkeletonRowCells = container.querySelectorAll('tbody tr:first-child td').length
    expect(firstSkeletonRowCells).toBe(headerCells)
  })
})
