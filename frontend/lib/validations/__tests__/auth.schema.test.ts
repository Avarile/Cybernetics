import { describe, it, expect } from 'vitest'
import {
  loginSchema,
  resetPasswordSchema,
  changePasswordSchema,
  passwordSchema,
} from '@/lib/validations/auth.schema'

describe('loginSchema', () => {
  it('lowercases + trims email', () => {
    const r = loginSchema.parse({ email: '  Foo@Bar.COM ', password: 'x' })
    expect(r.email).toBe('foo@bar.com')
  })
  it('requires a non-empty password without revealing policy', () => {
    const r = loginSchema.safeParse({ email: 'a@b.com', password: '' })
    expect(r.success).toBe(false)
  })
})

describe('passwordSchema', () => {
  it('rejects < 12 chars', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false)
  })
  it('accepts exactly 12 chars', () => {
    expect(passwordSchema.safeParse('a'.repeat(12)).success).toBe(true)
  })
})

describe('resetPasswordSchema', () => {
  it('requires a 6-digit code and matching passwords', () => {
    const ok = resetPasswordSchema.safeParse({
      email: 'a@b.com', code: '123456',
      newPassword: 'a'.repeat(12), confirmPassword: 'a'.repeat(12),
    })
    expect(ok.success).toBe(true)
    const badCode = resetPasswordSchema.safeParse({
      email: 'a@b.com', code: '12', newPassword: 'a'.repeat(12), confirmPassword: 'a'.repeat(12),
    })
    expect(badCode.success).toBe(false)
  })
})

describe('changePasswordSchema', () => {
  it('rejects when new == current', () => {
    const r = changePasswordSchema.safeParse({
      currentPassword: 'a'.repeat(12), newPassword: 'a'.repeat(12), confirmPassword: 'a'.repeat(12),
    })
    expect(r.success).toBe(false)
  })
})
