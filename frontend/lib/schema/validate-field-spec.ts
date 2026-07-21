import type { FieldSpec, FieldType } from '@/lib/interfaces/search.interface'

/** System field names on the Meili doc; a field-spec may not reuse them. Mirrors api/.../document-validator.ts. */
export const RESERVED_FIELD_NAMES: readonly string[] = ['id', 'externalId', 'collection', 'createdAt', 'updatedAt']
const FIELD_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/
const SCALARS: FieldType[] = ['string', 'number', 'boolean', 'date']

export const canBeSearchable = (t: FieldType) => t === 'string' || t === 'string[]'
export const canBeSortable = (t: FieldType) => SCALARS.includes(t)

/** Client mirror of the backend's validateFieldSpec. Returns human-readable errors (empty = valid). */
export function validateFieldSpec(fields: FieldSpec[]): string[] {
  const errors: string[] = []
  if (!Array.isArray(fields) || fields.length === 0) return ['A collection must declare at least one field']
  const seen = new Set<string>()
  for (const f of fields) {
    if (!FIELD_NAME_RE.test(f.name)) errors.push(`Invalid field name "${f.name}"`)
    if (RESERVED_FIELD_NAMES.includes(f.name)) errors.push(`"${f.name}" is a reserved field name`)
    if (seen.has(f.name)) errors.push(`Duplicate field "${f.name}"`)
    seen.add(f.name)
    if (f.searchable && !canBeSearchable(f.type)) errors.push(`Field "${f.name}" cannot be searchable (type ${f.type})`)
    if (f.sortable && !canBeSortable(f.type)) errors.push(`Field "${f.name}" cannot be sortable (type ${f.type})`)
  }
  if (!fields.some((f) => f.searchable)) errors.push('At least one field must be searchable')
  return errors
}
