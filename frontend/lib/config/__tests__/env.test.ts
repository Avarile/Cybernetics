import { describe, it, expect } from 'vitest'
import { parseClientEnv, parseServerEnv } from '@/lib/config/env'

describe('parseClientEnv', () => {
  it('parses a valid client env', () => {
    const env = parseClientEnv({
      NEXT_PUBLIC_API_URL: 'http://localhost:3000',
      NEXT_PUBLIC_APP_NAME: 'App',
    })
    expect(env).toEqual({ apiUrl: 'http://localhost:3000', appName: 'App' })
  })

  it('defaults appName when absent', () => {
    const env = parseClientEnv({ NEXT_PUBLIC_API_URL: 'http://localhost:3000' })
    expect(env.appName).toBe('Cybernetics')
  })

  it('throws a clear error when NEXT_PUBLIC_API_URL is missing', () => {
    expect(() => parseClientEnv({})).toThrow(/NEXT_PUBLIC_API_URL/)
  })
})

describe('parseServerEnv', () => {
  it('parses a valid server env', () => {
    expect(parseServerEnv({ API_URL: 'http://localhost:3000' })).toEqual({
      apiUrl: 'http://localhost:3000',
    })
  })
})
