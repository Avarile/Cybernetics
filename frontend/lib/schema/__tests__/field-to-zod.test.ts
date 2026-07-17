import { describe, it, expect } from 'vitest'
import { buildRecordSchema } from '@/lib/schema/field-to-zod'

describe('buildRecordSchema', () => {
  it('requires a required string and rejects empty', () => {
    const schema = buildRecordSchema([{ name: 'title', type: 'string', required: true }])
    expect(schema.safeParse({ title: 'hi' }).success).toBe(true)
    expect(schema.safeParse({ title: '' }).success).toBe(false)
  })
  it('coerces number inputs', () => {
    const schema = buildRecordSchema([{ name: 'price', type: 'number', required: true }])
    const parsed = schema.safeParse({ price: '42' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.price).toBe(42)
  })
  it('constrains enum values', () => {
    const schema = buildRecordSchema([{ name: 'status', type: 'string', enum: ['active', 'archived'] }])
    expect(schema.safeParse({ status: 'active' }).success).toBe(true)
    expect(schema.safeParse({ status: 'nope' }).success).toBe(false)
  })
  it('treats non-required fields as optional', () => {
    const schema = buildRecordSchema([{ name: 'note', type: 'string' }])
    expect(schema.safeParse({}).success).toBe(true)
  })
  it('accepts numeric enum values and coerces, rejecting out-of-set', () => {
    const schema = buildRecordSchema([{ name: 'rating', type: 'number', enum: [1, 2, 3], required: true }])
    const ok = schema.safeParse({ rating: '2' })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.rating).toBe(2)
    expect(schema.safeParse({ rating: 5 }).success).toBe(false)
  })
  it('rejects a blank required number instead of coercing to 0', () => {
    const schema = buildRecordSchema([{ name: 'price', type: 'number', required: true }])
    expect(schema.safeParse({ price: '' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })
  it('omits a blank optional number rather than storing 0', () => {
    const schema = buildRecordSchema([{ name: 'price', type: 'number' }])
    const parsed = schema.safeParse({ price: '' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.price).toBeUndefined()
  })
  it('still accepts a real numeric value', () => {
    const schema = buildRecordSchema([{ name: 'price', type: 'number', required: true }])
    const parsed = schema.safeParse({ price: '42' })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.price).toBe(42)
  })
})
