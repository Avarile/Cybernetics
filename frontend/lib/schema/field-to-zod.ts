import { z } from 'zod'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

/** Build a zod object schema for a collection's create/edit form. */
export function buildRecordSchema(fields: FieldSpec[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const f of fields) shape[f.name] = applyRequired(f, fieldToZod(f))
  return z.object(shape)
}

function fieldToZod(f: FieldSpec): z.ZodTypeAny {
  if (f.enum && f.enum.length) {
    if (f.type === 'number' || f.type === 'number[]') {
      const allowed = f.enum.map(Number)
      const member = z.coerce
        .number()
        .refine((n) => allowed.includes(n), { message: `Invalid value for ${f.name}` })
      return f.type === 'number[]' ? z.array(member) : member
    }
    const values = f.enum.map(String) as [string, ...string[]]
    return f.type === 'string[]' ? z.array(z.enum(values)) : z.enum(values)
  }
  switch (f.type) {
    case 'number': return z.coerce.number()
    case 'boolean': return z.boolean()
    case 'date': return z.string().min(1, `${f.name} is required`)
    case 'string[]': return z.array(z.string())
    case 'number[]': return z.array(z.coerce.number())
    default: return z.string()
  }
}

function applyRequired(f: FieldSpec, schema: z.ZodTypeAny): z.ZodTypeAny {
  if (!f.required) return schema.optional()
  if (schema instanceof z.ZodString) return schema.min(1, `${f.name} is required`)
  return schema
}
