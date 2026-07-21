import { describe, it, expect } from 'vitest'
import { validateFieldSpec, canBeSearchable, canBeSortable } from '@/lib/schema/validate-field-spec'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

describe('validateFieldSpec (client mirror)', () => {
  it('requires at least one searchable field', () => {
    expect(validateFieldSpec([{ name: 'a', type: 'string' }])).toContain('At least one field must be searchable')
  })
  it('rejects reserved + duplicate + bad names', () => {
    const fields: FieldSpec[] = [
      { name: 'id', type: 'string', searchable: true },
      { name: '1bad', type: 'string' },
      { name: 'dup', type: 'string' }, { name: 'dup', type: 'string' },
    ]
    const errs = validateFieldSpec(fields)
    expect(errs).toContain('"id" is a reserved field name')
    expect(errs).toContain('Invalid field name "1bad"')
    expect(errs).toContain('Duplicate field "dup"')
  })
  it('flags searchable on non-string and sortable on arrays', () => {
    const errs = validateFieldSpec([{ name: 'n', type: 'number', searchable: true, sortable: true }, { name: 't', type: 'string', searchable: true }])
    expect(errs).toContain('Field "n" cannot be searchable (type number)')
    expect(canBeSearchable('number')).toBe(false)
    expect(canBeSortable('string[]')).toBe(false)
  })
  it('flags sortable on a string[] field', () => {
    const errs = validateFieldSpec([
      { name: 'tags', type: 'string[]', sortable: true },
      { name: 't', type: 'string', searchable: true },
    ])
    expect(errs).toContain('Field "tags" cannot be sortable (type string[])')
  })
})
