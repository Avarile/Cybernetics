import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('@/lib/services/file.service', () => ({
  fileService: { initiate: vi.fn(), uploadToPolicy: vi.fn(), complete: vi.fn() },
}))

import { fileService } from '@/lib/services/file.service'
import { useFileUpload } from '@/lib/hooks/use-file-upload'

beforeEach(() => vi.clearAllMocks())

describe('useFileUpload', () => {
  it('runs initiate → upload → complete and returns file ids', async () => {
    vi.mocked(fileService.initiate).mockResolvedValue({ fileId: 'f1', deduplicated: false, upload: { url: 'u', expiresIn: 60 } })
    vi.mocked(fileService.uploadToPolicy).mockResolvedValue()
    vi.mocked(fileService.complete).mockResolvedValue({} as never)
    const { result } = renderHook(() => useFileUpload())
    let ids: string[] = []
    await act(async () => {
      ids = await result.current.uploadAll([new File(['x'], 'a.pdf', { type: 'application/pdf' })])
    })
    expect(ids).toEqual(['f1'])
    expect(fileService.complete).toHaveBeenCalledWith('f1')
  })

  it('skips upload+complete when deduplicated', async () => {
    vi.mocked(fileService.initiate).mockResolvedValue({ fileId: 'dup', deduplicated: true })
    const { result } = renderHook(() => useFileUpload())
    let ids: string[] = []
    await act(async () => {
      ids = await result.current.uploadAll([new File(['x'], 'a.pdf')])
    })
    expect(ids).toEqual(['dup'])
    expect(fileService.uploadToPolicy).not.toHaveBeenCalled()
    expect(fileService.complete).not.toHaveBeenCalled()
  })

  it('marks not-yet-attempted files as error when an earlier upload fails', async () => {
    vi.mocked(fileService.initiate).mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useFileUpload())
    const f1 = new File(['a'], 'a.pdf', { type: 'application/pdf' })
    const f2 = new File(['b'], 'b.pdf', { type: 'application/pdf' })
    await act(async () => {
      await expect(result.current.uploadAll([f1, f2])).rejects.toThrow('boom')
    })
    expect(result.current.items.find((i) => i.file === f1)?.status).toBe('error')
    expect(result.current.items.find((i) => i.file === f2)?.status).toBe('error')
  })
})
