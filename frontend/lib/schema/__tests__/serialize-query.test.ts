import { describe, it, expect } from 'vitest'
import { toSearchRequestBody } from '@/lib/schema/serialize-query'
import type { SearchQuery } from '@/lib/interfaces/search.interface'

const base: SearchQuery = { q: '', page: 1, limit: 20, filters: {}, sort: [] }

describe('toSearchRequestBody', () => {
  it('omits empty q, filters, and sort', () => {
    expect(toSearchRequestBody(base)).toEqual({ page: 1, limit: 20 })
  })
  it('trims q and maps sort specs to "field:dir"', () => {
    const out = toSearchRequestBody({ ...base, q: '  laptop ', sort: [{ field: 'price', dir: 'desc' }] })
    expect(out.q).toBe('laptop')
    expect(out.sort).toEqual(['price:desc'])
  })
  it('drops empty-array and empty-string filter values', () => {
    const out = toSearchRequestBody({ ...base, filters: { tags: [], status: '', active: true, cat: ['a'] } })
    expect(out.filters).toEqual({ active: true, cat: ['a'] })
  })
})
