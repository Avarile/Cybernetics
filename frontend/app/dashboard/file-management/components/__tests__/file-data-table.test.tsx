import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/state-management/file-management.store', async (orig) => {
  const actual = await orig<typeof import('@/lib/state-management/file-management.store')>()
  return actual
})
vi.mock('@/app/dashboard/file-management/components/file-row-actions', () => ({
  FileRowActions: () => <span>actions</span>,
}))

import { FileDataTable } from '@/app/dashboard/file-management/components/file-data-table'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const row = (over: Partial<FileMetadata> = {}): FileMetadata => ({
  id: 'f1', ownerId: null, filename: 'report.pdf', mimeType: 'application/pdf', size: 2100000,
  checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '2026-07-20T10:00:00Z', updatedAt: '', ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('FileDataTable', () => {
  it('renders a row from data', () => {
    render(<FileDataTable items={[row()]} pageCount={1} totalItems={1} isLoading={false} onRetry={vi.fn()} />)
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
    expect(screen.getByText('1 file(s)')).toBeInTheDocument()
  })
  it('renders an empty state', () => {
    render(<FileDataTable items={[]} pageCount={0} totalItems={0} isLoading={false} onRetry={vi.fn()} />)
    expect(screen.getByText('No files')).toBeInTheDocument()
  })
  it('renders an error state with retry', () => {
    render(<FileDataTable items={[]} pageCount={0} totalItems={0} isLoading={false} error={new Error('x')} onRetry={vi.fn()} />)
    expect(screen.getByText('Could not load files')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
