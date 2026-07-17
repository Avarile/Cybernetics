import { describe, it, expect, beforeEach, vi } from 'vitest'
import MockAdapter from 'axios-mock-adapter'
import Cookies from 'js-cookie'
import {
  getRefreshToken, applyTokenPair, clearSession, refreshSession, refreshClient,
} from '@/lib/auth/session'
import { getAccessToken, setAccessToken } from '@/lib/http/token-store'
import { REFRESH_COOKIE } from '@/lib/config/constants'

const mock = new MockAdapter(refreshClient)

beforeEach(() => {
  mock.reset()
  setAccessToken(null)
  Cookies.remove(REFRESH_COOKIE, { path: '/' })
})

describe('applyTokenPair / getRefreshToken / clearSession', () => {
  it('applies a token pair to memory + cookie', () => {
    applyTokenPair({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    expect(getAccessToken()).toBe('a')
    expect(getRefreshToken()).toBe('r')
  })
  it('clears both', () => {
    applyTokenPair({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 })
    clearSession()
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeUndefined()
  })
})

describe('refreshSession', () => {
  it('posts the current refresh token and applies the rotated pair', async () => {
    applyTokenPair({ accessToken: 'old-a', refreshToken: 'old-r', expiresIn: 900 })
    mock.onPost('/auth/refresh').reply((config) => {
      expect(JSON.parse(config.data)).toEqual({ refreshToken: 'old-r' })
      return [200, { accessToken: 'new-a', refreshToken: 'new-r', expiresIn: 900 }]
    })
    const pair = await refreshSession()
    expect(pair.accessToken).toBe('new-a')
    expect(getAccessToken()).toBe('new-a')
    expect(getRefreshToken()).toBe('new-r')
  })
  it('throws when there is no refresh token', async () => {
    await expect(refreshSession()).rejects.toThrow(/no refresh token/i)
  })
})
