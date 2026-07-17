import { describe, it, expect } from 'vitest'
import { isAuthRoute, isProtectedRoute, isAdminRoute } from '@/lib/auth/route-policy'

describe('route-policy', () => {
  it('recognizes auth routes', () => {
    expect(isAuthRoute('/auth/login')).toBe(true)
    expect(isAuthRoute('/auth/reset-password')).toBe(true)
    expect(isAuthRoute('/dashboard')).toBe(false)
  })
  it('treats non-public app routes as protected', () => {
    expect(isProtectedRoute('/dashboard')).toBe(true)
    expect(isProtectedRoute('/account')).toBe(true)
    expect(isProtectedRoute('/auth/login')).toBe(false)
    expect(isProtectedRoute('/')).toBe(false)
  })
  it('recognizes admin routes', () => {
    expect(isAdminRoute('/admin/users')).toBe(true)
    expect(isAdminRoute('/dashboard')).toBe(false)
  })
})
