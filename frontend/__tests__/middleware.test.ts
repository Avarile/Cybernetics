// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'
import middleware from '@/middleware'
import { REFRESH_COOKIE } from '@/lib/config/constants'

function req(path: string, opts?: { authed?: boolean }) {
  const r = new NextRequest(new URL(`http://localhost${path}`))
  if (opts?.authed) r.cookies.set(REFRESH_COOKIE, 'r')
  return r
}

describe('middleware', () => {
  it('redirects unauthenticated users away from protected routes', () => {
    const res = middleware(req('/dashboard'))
    expect(res.status).toBe(307)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/auth/login')
    expect(loc).toContain('callbackUrl=%2Fdashboard')
  })
  it('lets authenticated users into protected routes', () => {
    const res = middleware(req('/dashboard', { authed: true }))
    expect(res.headers.get('location')).toBeNull()
  })
  it('redirects authenticated users away from auth pages', () => {
    const res = middleware(req('/auth/login', { authed: true }))
    expect(res.headers.get('location')).toContain('/dashboard')
  })
  it('leaves the public landing alone', () => {
    const res = middleware(req('/'))
    expect(res.headers.get('location')).toBeNull()
  })
})
