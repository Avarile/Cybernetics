import { describe, it, expect } from 'vitest'
import { scorePassword } from '@/lib/auth/password-strength'

describe('scorePassword', () => {
  it('scores empty as weak/0', () => {
    expect(scorePassword('')).toEqual({ score: 0, label: 'weak' })
  })
  it('scores a long varied password as strong', () => {
    const r = scorePassword('Abcdef123!@#xyzA')
    expect(r.score).toBe(4)
    expect(r.label).toBe('strong')
  })
  it('scores a long but single-class password below strong', () => {
    expect(scorePassword('a'.repeat(16)).score).toBeLessThan(4)
  })
})
