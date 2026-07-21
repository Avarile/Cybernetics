import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/http/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }))

import { apiClient } from '@/lib/http/api-client'
import { fileService } from '@/lib/services/file.service'

beforeEach(() => vi.clearAllMocks())

describe('fileService', () => {
  it('initiate posts declared metadata to /files', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { fileId: 'f1', deduplicated: false } })
    const r = await fileService.initiate({ filename: 'a.pdf', mimeType: 'application/pdf', size: 10 })
    expect(apiClient.post).toHaveBeenCalledWith('/files', { filename: 'a.pdf', mimeType: 'application/pdf', size: 10 })
    expect(r.fileId).toBe('f1')
  })

  it('uploadToPolicy posts multipart form with fields then file', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })
    await fileService.uploadToPolicy({ url: 'http://minio/bucket', fields: { key: 'k', policy: 'p' }, expiresIn: 60 }, file)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://minio/bucket')
    const form = init.body as FormData
    expect(form.get('key')).toBe('k')
    expect(form.get('file')).toBe(file)
    expect(Array.from(form.keys())).toEqual(['key', 'policy', 'file'])
    vi.unstubAllGlobals()
  })

  it('downloadUrl returns the presigned url', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { url: 'http://minio/get', expiresIn: 60 } })
    expect(await fileService.downloadUrl('f1')).toBe('http://minio/get')
  })
})

describe('fileService.list', () => {
  it('omits status when ALL and passes paging + mimeType', async () => {
    const page = { items: [], total: 0, page: 2, limit: 20 }
    vi.mocked(apiClient.get).mockResolvedValue({ data: page })
    const res = await fileService.list({ status: 'ALL', mimeType: 'application/pdf', page: 2, limit: 20 })
    expect(apiClient.get).toHaveBeenCalledWith('/files', {
      params: { page: 2, limit: 20, mimeType: 'application/pdf' },
    })
    expect(res).toEqual(page)
  })

  it('sends status when not ALL', async () => {
    const page = { items: [], total: 0, page: 1, limit: 20 }
    vi.mocked(apiClient.get).mockResolvedValue({ data: page })
    const res = await fileService.list({ status: 'QUARANTINED', page: 1, limit: 20 })
    expect(apiClient.get).toHaveBeenCalledWith('/files', {
      params: { page: 1, limit: 20, status: 'QUARANTINED' },
    })
    expect(res).toEqual(page)
  })
})

describe('fileService.remove', () => {
  it('DELETEs the file by id', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined })
    await expect(fileService.remove('abc')).resolves.toBeUndefined()
    expect(apiClient.delete).toHaveBeenCalledWith('/files/abc')
  })
})
