import { z } from 'zod'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

/** Build a zod object schema for a collection's create/edit form. */
export function buildRecordSchema(fields: FieldSpec[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) shape[f.name] = fieldSchema(f)
  return z.object(shape)
}

/** '' / null / undefined all mean "no value" for a numeric field. */
const emptyToUndefined = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : v)

function fieldSchema(f: FieldSpec): z.ZodTypeAny {
  // Numbers must never coerce a blank input to 0. Optionality is handled inline:
  // a blank required number fails; a blank optional number resolves to undefined.
  if (f.type === 'number' || f.type === 'number[]') {
    const member =
      f.enum && f.enum.length
        ? z.coerce
            .number()
            .refine((n) => f.enum!.map(Number).includes(n), { message: `Invalid value for ${f.name}` })
        : z.coerce.number()
    if (f.type === 'number[]') {
      const arr = z.array(member)
      return f.required ? arr : arr.optional()
    }
    return f.required
      ? z.preprocess(emptyToUndefined, member)
      : z.preprocess(emptyToUndefined, member.optional())
  }
  return applyRequired(f, fieldToZod(f))
}

function fieldToZod(f: FieldSpec): z.ZodTypeAny {
  if (f.enum && f.enum.length) {
    const values = f.enum.map(String) as [string, ...string[]]
    return f.type === 'string[]' ? z.array(z.enum(values)) : z.enum(values)
  }
  switch (f.type) {
    case 'boolean':
      return z.boolean()
    case 'date':
      return z.string().min(1, `${f.name} is required`)
    case 'string[]':
      return z.array(z.string())
    default:
      return z.string()
  }
}

function applyRequired(f: FieldSpec, schema: z.ZodTypeAny): z.ZodTypeAny {
  if (!f.required) return schema.optional()
  if (schema instanceof z.ZodString) return schema.min(1, `${f.name} is required`)
  return schema
}
