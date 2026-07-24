import { describe, it, expect } from 'vitest'
import { recordsRefreshInterval } from '@/lib/hooks/use-records'

describe('recordsRefreshInterval', () => {
  it('polls inside the watch window, stops after', () => {
    const now = 1_000_000
    expect(recordsRefreshInterval(now + 5000, now)).toBe(4000)
    expect(recordsRefreshInterval(now - 1, now)).toBe(0)
    expect(recordsRefreshInterval(0, now)).toBe(0)
  })
})
