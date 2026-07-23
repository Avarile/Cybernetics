import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const clearSelection = vi.fn()
const cancelDelete = vi.fn()
const closeDetail = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ deleteTarget: ['a', 'b'], clearSelection, cancelDelete, closeDetail }),
}))
const remove = vi.fn().mockResolvedValue({ ok: 1, failed: 1 })
vi.mock('@/lib/hooks/use-file-mutations', () => ({ useFileMutations: () => ({ remove }) }))
const toastSuccess = vi.fn(); const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }))

import { FileDeleteDialog } from '@/app/dashboard/file-management/components/file-delete-dialog'

beforeEach(() => vi.clearAllMocks())

describe('FileDeleteDialog', () => {
  it('deletes the target and reports partial failure', async () => {
    render(<FileDeleteDialog />)
    expect(screen.getByText(/Delete 2 file/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(remove).toHaveBeenCalledWith(['a', 'b'])
    expect(toastError).toHaveBeenCalled()
    expect(clearSelection).toHaveBeenCalled()
  })
})
