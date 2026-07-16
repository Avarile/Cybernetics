import { z } from 'zod';
import type { FieldSpec } from '../../../infrastructure/database/schema/search.schema';
import { fieldSpecSchema, refineFields } from './create-collection.dto';

export const updateCollectionSchema = z
  .object({
    displayName: z.string().min(1).max(255).optional(),
    description: z.string().max(500).nullable().optional(),
    fields: z.array(fieldSpecSchema).min(1).optional(),
  })
  .superRefine((val, ctx) =>
    refineFields(val.fields as FieldSpec[] | undefined, ctx),
  );

export type UpdateCollectionDto = z.infer<typeof updateCollectionSchema>;
