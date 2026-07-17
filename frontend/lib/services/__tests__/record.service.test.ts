import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/http/api-client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import { apiClient } from '@/lib/http/api-client'
import { recordService } from '@/lib/services/record.service'
import { collectionService } from '@/lib/services/collection.service'

beforeEach(() => vi.clearAllMocks())

describe('recordService', () => {
  it('query posts the serialized body to /query', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: { hits: [], page: 1, limit: 20, totalHits: 0, totalPages: 0, processingTimeMs: 1 } })
    await recordService.query('products', { q: 'x', page: 2, limit: 20, filters: {}, sort: [] })
    expect(apiClient.post).toHaveBeenCalledWith('/search/collections/products/query', { q: 'x', page: 2, limit: 20 })
  })
  it('persist wraps records under { records }', async () => {
    vi.mocked(apiClient.post).mockResolvedValue({ data: [] })
    await recordService.persist('products', [{ externalId: 'e1', document: { a: 1 } }])
    expect(apiClient.post).toHaveBeenCalledWith('/search/collections/products/records', { records: [{ externalId: 'e1', document: { a: 1 } }] })
  })
  it('remove deletes by id', async () => {
    vi.mocked(apiClient.delete).mockResolvedValue({ data: undefined })
    await recordService.remove('products', 'abc')
    expect(apiClient.delete).toHaveBeenCalledWith('/search/collections/products/records/abc')
  })
})

describe('collectionService', () => {
  it('get fetches a single collection by name', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { name: 'products', fields: [] } })
    await collectionService.get('products')
    expect(apiClient.get).toHaveBeenCalledWith('/search/collections/products')
  })
})
