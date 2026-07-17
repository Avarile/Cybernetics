import { describe, it, expect, beforeEach } from 'vitest'
import { getAccessToken, setAccessToken } from '@/lib/http/token-store'

describe('token-store', () => {
  beforeEach(() => setAccessToken(null))

  it('starts null', () => {
    expect(getAccessToken()).toBeNull()
  })
  it('stores and clears the access token', () => {
    setAccessToken('abc')
    expect(getAccessToken()).toBe('abc')
    setAccessToken(null)
    expect(getAccessToken()).toBeNull()
  })
})
