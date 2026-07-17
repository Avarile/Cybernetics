import { describe, it, expect } from 'vitest'
import { buildRecordSchema } from '@/lib/schema/field-to-zod'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

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
})
