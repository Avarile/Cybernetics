import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Table } from '@tanstack/react-table'
import { FilePagination } from '@/app/dashboard/file-management/components/file-pagination'

const fakeTable = () =>
  ({
    getState: () => ({ pagination: { pageIndex: 1, pageSize: 20 } }),
    getPageCount: () => 3,
    getFilteredSelectedRowModel: () => ({ rows: [] }),
    getFilteredRowModel: () => ({ rows: [{}, {}] }),
    getCanPreviousPage: () => true,
    getCanNextPage: () => true,
    setPageIndex: vi.fn(), previousPage: vi.fn(), nextPage: vi.fn(), setPageSize: vi.fn(),
  }) as unknown as Table<unknown>

describe('FilePagination', () => {
  it('shows the current page position', () => {
    render(<FilePagination table={fakeTable()} />)
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })
})
