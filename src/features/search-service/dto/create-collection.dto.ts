import { z } from 'zod';
import type { FieldSpec } from '../../../infrastructure/database/schema/search.schema';
import { validateFieldSpec } from '../document-validator';

const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'string[]',
  'number[]',
] as const;

/** One field-spec entry. Structural cross-field rules run in `validateFieldSpec`. */
export const fieldSpecSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  searchable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
});

/** Attach `validateFieldSpec` errors as Zod issues on a `fields` array. */
export function refineFields(
  fields: FieldSpec[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!fields) return;
  for (const message of validateFieldSpec(fields)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['fields'] });
  }
}

export const createCollectionSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'name must be lower_snake_case')
      .max(100),
    displayName: z.string().min(1).max(255),
    description: z.string().max(500).optional(),
    fields: z.array(fieldSpecSchema).min(1),
  })
  .superRefine((val, ctx) => refineFields(val.fields as FieldSpec[], ctx));

export type CreateCollectionDto = z.infer<typeof createCollectionSchema>;
