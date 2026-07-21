import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const initiate = vi.fn()
const uploadToPolicy = vi.fn()
const complete = vi.fn()
vi.mock('@/lib/services/file.service', () => ({
  fileService: {
    initiate: (...a: unknown[]) => initiate(...a),
    uploadToPolicy: (...a: unknown[]) => uploadToPolicy(...a),
    complete: (...a: unknown[]) => complete(...a),
  },
}))

import { useFileUpload } from '@/lib/hooks/use-file-upload'

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([0xab, 0xcd]).buffer)
})

describe('useFileUpload', () => {
  it('hashes, initiates with sha256, uploads, completes, and marks done', async () => {
    initiate.mockResolvedValue({ fileId: 'f1', deduplicated: false, upload: { url: 'http://x', fields: {}, expiresIn: 60 } })
    uploadToPolicy.mockResolvedValue(undefined)
    complete.mockResolvedValue({ id: 'f1' })
    const { result } = renderHook(() => useFileUpload())

    let ids: string[] = []
    await act(async () => { ids = await result.current.uploadAll([file('a.pdf')]) })

    expect(initiate).toHaveBeenCalledWith(expect.objectContaining({ filename: 'a.pdf', sha256: 'abcd' }))
    expect(uploadToPolicy).toHaveBeenCalled()
    expect(complete).toHaveBeenCalledWith('f1', 'abcd')
    expect(ids).toEqual(['f1'])
    expect(result.current.items[0].status).toBe('done')
  })

  it('marks deduplicated files without uploading', async () => {
    initiate.mockResolvedValue({ fileId: 'dup', deduplicated: true })
    const { result } = renderHook(() => useFileUpload())
    await act(async () => { await result.current.uploadAll([file('d.pdf')]) })
    expect(uploadToPolicy).not.toHaveBeenCalled()
    expect(result.current.items[0].status).toBe('deduplicated')
  })

  it('isolates failures — one bad file does not abort the others', async () => {
    initiate
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ fileId: 'ok', deduplicated: true })
    const { result } = renderHook(() => useFileUpload())
    let ids: string[] = []
    await act(async () => { ids = await result.current.uploadAll([file('bad.pdf'), file('good.pdf')]) })
    await waitFor(() => expect(result.current.items).toHaveLength(2))
    expect(ids).toEqual(['ok'])
    expect(result.current.items.find((i) => i.file.name === 'bad.pdf')?.status).toBe('error')
    expect(result.current.items.find((i) => i.file.name === 'good.pdf')?.status).toBe('deduplicated')
  })
})
