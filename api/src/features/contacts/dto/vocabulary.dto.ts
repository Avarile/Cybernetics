import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const keySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'key must be lower_snake_case');

export const createContactTypeSchema = z.object({
  key: keySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  color: z.string().max(16).optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export class CreateContactTypeDto extends createZodDto(
  createContactTypeSchema,
) {}

export const updateContactTypeSchema = createContactTypeSchema
  .omit({ key: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateContactTypeDto extends createZodDto(
  updateContactTypeSchema,
) {}

export const createCategorySchema = z.object({
  key: keySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  parentId: z.string().uuid().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export class CreateCategoryDto extends createZodDto(createCategorySchema) {}

export const updateCategorySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullable().optional(),
    /** Moving a node rewrites its subtree's paths; cycles are rejected. */
    parentId: z.string().uuid().nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
