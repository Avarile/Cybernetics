import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mutate = vi.fn()
vi.mock('@/lib/hooks/use-files', () => ({
  useFiles: () => ({
    data: {
      items: [
        { id: 'f1', ownerId: null, filename: 'report.pdf', mimeType: 'application/pdf', size: 2100000, checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '2026-07-20T10:00:00Z', updatedAt: '' },
        { id: 'f2', ownerId: null, filename: 'photo.png', mimeType: 'image/png', size: 800000, checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '2026-07-20T10:00:00Z', updatedAt: '' },
      ],
      total: 2, page: 1, limit: 20,
    },
    isLoading: false, error: undefined, mutate,
  }),
}))
vi.mock('@/lib/state-management/file-management.store', async (orig) => {
  const actual = await orig<typeof import('@/lib/state-management/file-management.store')>()
  return { ...actual, useFileManagementStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ nameFilter: 'photo', selection: {}, columnVisibility: {}, setSelection: vi.fn(), setColumnVisibility: vi.fn(), setPage: vi.fn(), setLimit: vi.fn(), page: 1, limit: 20 }),
    { getState: () => ({ watchUntil: 0 }) },
  ) }
})
// Stub the heavy leaf components to keep this an integration test of the view's own logic.
vi.mock('@/app/dashboard/file-management/components/file-toolbar', () => ({ FileToolbar: () => <div>toolbar</div> }))
vi.mock('@/app/dashboard/file-management/components/file-status-tabs', () => ({ FileStatusTabs: () => <div>tabs</div> }))
vi.mock('@/app/dashboard/file-management/components/file-upload-dialog', () => ({ FileUploadDialog: () => null }))
vi.mock('@/app/dashboard/file-management/components/file-detail-drawer', () => ({ FileDetailDrawer: () => null }))
vi.mock('@/app/dashboard/file-management/components/file-delete-dialog', () => ({ FileDeleteDialog: () => null }))
vi.mock('@/app/dashboard/file-management/components/file-data-table', () => ({
  FileDataTable: ({ items, totalItems }: { items: { filename: string }[]; totalItems: number }) => (
    <div>
      <span data-testid="row-count">{items.length}</span>
      <span data-testid="total">{totalItems}</span>
      {items.map((i) => <div key={i.filename}>{i.filename}</div>)}
    </div>
  ),
}))

import { FileManagementView } from '@/app/dashboard/file-management/components/file-management-view'

beforeEach(() => vi.clearAllMocks())

describe('FileManagementView', () => {
  it('applies the client-side name filter to the displayed rows', () => {
    render(<FileManagementView />)
    expect(screen.getByRole('heading', { name: /file management/i })).toBeInTheDocument()
    expect(screen.getByTestId('row-count')).toHaveTextContent('1')
    expect(screen.getByText('photo.png')).toBeInTheDocument()
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
  })
})
