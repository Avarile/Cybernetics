import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const openUpload = vi.fn(); const setNameFilter = vi.fn(); const requestDelete = vi.fn()
const state = {
  nameFilter: '', mimeType: undefined as string | undefined, selection: {} as Record<string, boolean>,
  openUpload, setNameFilter, setMimeType: vi.fn(), requestDelete,
}
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) => sel(state),
}))

import { FileToolbar } from '@/app/dashboard/file-management/components/file-toolbar'

beforeEach(() => { vi.clearAllMocks(); state.selection = {} })

describe('FileToolbar', () => {
  it('opens the upload dialog', async () => {
    render(<FileToolbar onRefresh={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /upload/i }))
    expect(openUpload).toHaveBeenCalled()
  })
  it('calls onRefresh', async () => {
    const onRefresh = vi.fn()
    render(<FileToolbar onRefresh={onRefresh} />)
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }))
    expect(onRefresh).toHaveBeenCalled()
  })
  it('shows bulk delete when rows are selected', () => {
    state.selection = { a: true, b: true }
    render(<FileToolbar onRefresh={vi.fn()} />)
    expect(screen.getByRole('button', { name: /delete \(2\)/i })).toBeInTheDocument()
  })
})
