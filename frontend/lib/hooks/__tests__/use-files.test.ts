import { describe, it, expect } from 'vitest'
import { computeRefreshInterval } from '@/lib/hooks/use-files'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

const f = (status: string): FileMetadata => ({
  id: 'x', ownerId: null, filename: 'a', mimeType: 'text/plain', size: 1,
  checksumSha256: null, status, metadata: {}, createdAt: '', updatedAt: '',
})

describe('computeRefreshInterval', () => {
  it('polls while a file is PENDING', () => {
    expect(computeRefreshInterval([f('PENDING')], 0, 1000)).toBe(4000)
  })
  it('polls while inside the watch window even if all AVAILABLE', () => {
    expect(computeRefreshInterval([f('AVAILABLE')], 5000, 1000)).toBe(4000)
  })
  it('stops when stable and past the watch window', () => {
    expect(computeRefreshInterval([f('AVAILABLE')], 500, 1000)).toBe(0)
  })
  it('stops with no data and no watch', () => {
    expect(computeRefreshInterval(undefined, 0, 1000)).toBe(0)
  })
})
