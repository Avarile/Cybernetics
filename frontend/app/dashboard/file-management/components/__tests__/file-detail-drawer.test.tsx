import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const requestDelete = vi.fn()
const closeDetail = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ detailId: 'f1', closeDetail, requestDelete }),
}))
vi.mock('@/lib/hooks/use-file-detail', () => ({
  useFileDetail: () => ({
    file: {
      id: 'f1', ownerId: null, filename: 'bad.zip', mimeType: 'application/zip', size: 4000000,
      checksumSha256: 'abc', status: 'QUARANTINED', metadata: { quarantineReason: 'mime-mismatch' },
      createdAt: '2026-07-20T10:00:00Z', updatedAt: '2026-07-20T10:00:05Z',
    },
    isLoading: false, error: undefined, mutate: vi.fn(),
  }),
}))
vi.mock('@/lib/services/file.service', () => ({ fileService: { downloadUrl: vi.fn() } }))

import { FileDetailDrawer } from '@/app/dashboard/file-management/components/file-detail-drawer'

beforeEach(() => vi.clearAllMocks())

describe('FileDetailDrawer', () => {
  it('shows metadata and the quarantine reason', () => {
    render(<FileDetailDrawer />)
    expect(screen.getByText('bad.zip')).toBeInTheDocument()
    expect(screen.getByText(/mime-mismatch/)).toBeInTheDocument()
  })
})
