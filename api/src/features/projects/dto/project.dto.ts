import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PROJECT_STATUSES = [
  'draft',
  'active',
  'on_hold',
  'completed',
  'archived',
  'cancelled',
] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export const PROJECT_VISIBILITIES = ['private', 'internal'] as const;
export const MEMBER_ROLES = [
  'owner',
  'manager',
  'contributor',
  'viewer',
] as const;

export const createProjectSchema = z.object({
  /** Short human code, prefixing task numbers (`ACME-42`). */
  key: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Z][A-Z0-9_]*$/, 'key must be UPPER_SNAKE_CASE'),
  name: z.string().min(1).max(255),
  description: z.string().max(50_000).optional(),
  status: z.enum(PROJECT_STATUSES).default('draft'),
  priority: z.enum(PRIORITIES).default('medium'),
  leadUserId: z.string().uuid().optional(),
  parentProjectId: z.string().uuid().optional(),
  /** Restrictive by default, as everything else in this schema is. */
  visibility: z.enum(PROJECT_VISIBILITIES).default('private'),
  startDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  budgetAmount: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  currency: z.string().length(3).optional(),
  color: z.string().max(16).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

export class CreateProjectDto extends createZodDto(createProjectSchema) {}

export const updateProjectSchema = createProjectSchema
  .omit({ key: true })
  .partial()
  .extend({ ownerUserId: z.string().uuid().nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field must be provided',
  });

export class UpdateProjectDto extends createZodDto(updateProjectSchema) {}

export const listProjectsSchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListProjectsDto extends createZodDto(listProjectsSchema) {}

export const addMemberSchema = z.object({
  userId: z.string().uuid(),
  roleInProject: z.enum(MEMBER_ROLES).default('contributor'),
});

export class AddMemberDto extends createZodDto(addMemberSchema) {}

export const linkKnowledgeSchema = z.object({
  knowledgeId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  relation: z
    .enum(['reference', 'requirement', 'deliverable', 'background'])
    .default('reference'),
  note: z.string().max(500).optional(),
});

export class LinkKnowledgeDto extends createZodDto(linkKnowledgeSchema) {}

export const linkProjectContactSchema = z.object({
  contactId: z.string().uuid(),
  relationship: z
    .enum(['client', 'stakeholder', 'vendor', 'partner', 'sponsor', 'other'])
    .default('stakeholder'),
  isPrimary: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

export class LinkProjectContactDto extends createZodDto(
  linkProjectContactSchema,
) {}
