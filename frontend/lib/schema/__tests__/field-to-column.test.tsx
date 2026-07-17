import { describe, it, expect } from 'vitest'
import { buildColumns, type RecordColumnMeta } from '@/lib/schema/field-to-column'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

const fields: FieldSpec[] = [
  { name: 'title', type: 'string' },
  { name: 'price', type: 'number', sortable: true },
]

describe('buildColumns', () => {
  it('creates one column per field with ids and sort flags', () => {
    const cols = buildColumns(fields)
    expect(cols.map((c) => c.id)).toEqual(['title', 'price'])
    expect(cols[0].enableSorting).toBe(false)
    expect(cols[1].enableSorting).toBe(true)
  })
  it('carries the field spec in column meta', () => {
    const cols = buildColumns(fields)
    expect((cols[1].meta as RecordColumnMeta).field.name).toBe('price')
  })
})
