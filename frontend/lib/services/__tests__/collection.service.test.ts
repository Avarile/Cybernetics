import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/http/api-client', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }))
import { apiClient } from '@/lib/http/api-client'
import { collectionService } from '@/lib/services/collection.service'

beforeEach(() => vi.clearAllMocks())

describe('collectionService mutations', () => {
  it('create posts to /search/collections', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} })
    await collectionService.create({ name: 'c', displayName: 'C', fields: [{ name: 'a', type: 'string', searchable: true }] })
    expect(apiClient.post).toHaveBeenCalledWith('/search/collections', expect.objectContaining({ name: 'c' }))
  })
  it('update patches by name', async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({ data: {} })
    await collectionService.update('c', { displayName: 'C2' })
    expect(apiClient.patch).toHaveBeenCalledWith('/search/collections/c', { displayName: 'C2' })
  })
  it('remove deletes by name', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined })
    await collectionService.remove('c')
    expect(apiClient.delete).toHaveBeenCalledWith('/search/collections/c')
  })
})
