import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const startWatch = vi.fn()
const closeUpload = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileManagementStore: (sel: (s: unknown) => unknown) =>
    sel({ uploadOpen: true, closeUpload, startWatch }),
}))
const uploadAll = vi.fn().mockResolvedValue(['f1'])
vi.mock('@/lib/hooks/use-file-upload', () => ({
  useFileUpload: () => ({ items: [], uploadAll, reset: vi.fn() }),
}))
const mutate = vi.fn()
vi.mock('swr', () => ({ useSWRConfig: () => ({ mutate }) }))

import { FileUploadDialog } from '@/app/dashboard/file-management/components/file-upload-dialog'

beforeEach(() => vi.clearAllMocks())

describe('FileUploadDialog', () => {
  it('uploads dropped files then revalidates and starts the watch window', async () => {
    render(<FileUploadDialog />)
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('file-dropzone'), { dataTransfer: { files: [file] } })
    await waitFor(() => expect(uploadAll).toHaveBeenCalledWith([file]))
    await waitFor(() => expect(startWatch).toHaveBeenCalled())
    expect(mutate).toHaveBeenCalled()
  })
})
