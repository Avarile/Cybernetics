import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const openDetail = vi.fn()
const requestDelete = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ openDetail, requestDelete }),
}))
vi.mock('@/lib/services/file.service', () => ({ fileService: { downloadUrl: vi.fn() } }))

import { FileRowActions } from '@/app/dashboard/file-management/components/file-row-actions'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const meta = (over: Partial<FileMetadata> = {}): FileMetadata => ({
  id: 'f1', ownerId: null, filename: 'a.pdf', mimeType: 'application/pdf', size: 1,
  checksumSha256: null, status: 'AVAILABLE', metadata: {}, createdAt: '', updatedAt: '', ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('FileRowActions', () => {
  it('opens details from the menu', async () => {
    render(<FileRowActions file={meta()} />)
    await userEvent.click(screen.getByRole('button', { name: /open menu/i }))
    await userEvent.click(screen.getByText('Details'))
    expect(openDetail).toHaveBeenCalledWith('f1')
  })

  it('disables Download for a non-available file', async () => {
    render(<FileRowActions file={meta({ status: 'PENDING' })} />)
    await userEvent.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByText('Download').closest('[role="menuitem"]')).toHaveAttribute('aria-disabled', 'true')
  })
})
