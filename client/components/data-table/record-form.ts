/**
 * Field specs for the create/edit/detail windows.
 *
 * Explicit rather than derived from a zod schema. The backend DTOs carry
 * `.refine()` cross-field rules ("Provide a name or an email address"),
 * `.nullable().optional()` distinctions that mean different things on create
 * and update, and `z.coerce.date()` inputs — none of which survive a generic
 * schema-to-form walk intact. A declared field list is a few more lines and
 * says exactly what the form does.
 */
export type FieldKind = "text" | "email" | "tel" | "textarea" | "select" | "date"

export interface FormFieldSpec {
  key: string
  label: string
  kind: FieldKind
  placeholder?: string
  required?: boolean
  maxLength?: number
  options?: { value: string; label: string }[]
  /** Hidden on edit — e.g. a value the server derives after creation. */
  createOnly?: boolean
  /** Shown in the detail view but never editable. */
  readOnly?: boolean
  help?: string
}

export interface RecordFormSpec {
  fields: FormFieldSpec[]
  /** Client-side mirror of the DTO's cross-field `.refine()`. */
  validate?: (values: Record<string, string>) => string | null
  /** Strips empty strings so an untouched optional field is omitted rather
   *  than sent as "", which most of the DTOs reject. */
  serialize?: (values: Record<string, string>) => Record<string, unknown>
}

/** Drops blank values. Shared default for every domain. */
export function omitBlank(values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    const trimmed = typeof v === "string" ? v.trim() : v
    if (trimmed !== "" && trimmed !== undefined && trimmed !== null) out[k] = trimmed
  }
  return out
}
