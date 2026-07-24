import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const closeUpload = vi.fn()
const startWatch = vi.fn()
const setCollection = vi.fn()
vi.mock('@/lib/state-management/data-management.store', () => ({
  useDataManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ uploadOpen: true, closeUpload, startWatch, setCollection }),
}))
const uploadAll = vi.fn().mockResolvedValue(['f1'])
vi.mock('@/lib/hooks/use-file-upload', () => ({ useFileUpload: () => ({ items: [], uploadAll, reset: vi.fn() }) }))
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))
const { mockUseIsAdmin } = vi.hoisted(() => ({ mockUseIsAdmin: vi.fn(() => true) }))
vi.mock('@/lib/hooks/use-permission', () => ({ useIsAdmin: mockUseIsAdmin }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from 'sonner'
import { DocumentUploadDialog } from '@/components/data-management/document-upload-dialog'
beforeEach(() => {
  vi.clearAllMocks()
  mockUseIsAdmin.mockReturnValue(true)
})

describe('DocumentUploadDialog', () => {
  it('admin: uploads ingestable docs, selects the documents collection, watches + revalidates', async () => {
    render(<DocumentUploadDialog />)
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [pdf] } })
    await waitFor(() => expect(uploadAll).toHaveBeenCalledWith([pdf], undefined))
    await waitFor(() => expect(setCollection).toHaveBeenCalledWith('documents'))
    expect(startWatch).toHaveBeenCalled()
    expect(mutate).toHaveBeenCalled()
  })
  it('non-admin: uploads but does not navigate into the documents collection; shows a success toast', async () => {
    mockUseIsAdmin.mockReturnValue(false)
    render(<DocumentUploadDialog />)
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [pdf] } })
    await waitFor(() => expect(uploadAll).toHaveBeenCalledWith([pdf], undefined))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(setCollection).not.toHaveBeenCalled()
    expect(startWatch).not.toHaveBeenCalled()
  })
  it('ignores non-ingestable files and surfaces a rejected-file toast', async () => {
    render(<DocumentUploadDialog />)
    const png = new File(['x'], 'b.png', { type: 'image/png' })
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [png] } })
    await waitFor(() => expect(uploadAll).not.toHaveBeenCalled())
    expect(toast.error).toHaveBeenCalled()
  })
})
