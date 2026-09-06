import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const keySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'key must be lower_snake_case');

export const createKnowledgeTypeSchema = z.object({
  key: keySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  icon: z.string().max(60).optional(),
  color: z.string().max(16).optional(),
  /** Drives `knowledge.reviewDueAt` — a policy is re-checked, a note is not. */
  defaultReviewIntervalDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export class CreateKnowledgeTypeDto extends createZodDto(
  createKnowledgeTypeSchema,
) {}

export const updateKnowledgeTypeSchema = createKnowledgeTypeSchema
  .omit({ key: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateKnowledgeTypeDto extends createZodDto(
  updateKnowledgeTypeSchema,
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
    parentId: z.string().uuid().nullable().optional(),
    sortOrder: z.coerce.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
