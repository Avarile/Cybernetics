import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * A partial update of a conversation's user-controlled metadata.
 *
 * `title` is nullable on purpose: `null` clears the override and puts the row
 * back on the title Mastra generated for its thread. That is distinct from
 * omitting the field, which leaves the title alone — so the schema cannot use
 * `.optional()` alone to mean both.
 */
export const updateConversationSchema = z
  .object({
    title: z.string().max(500).nullable().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine((v) => v.title !== undefined || v.status !== undefined, {
    message: 'Provide at least one of `title` or `status`',
  });

export class UpdateConversationDto extends createZodDto(
  updateConversationSchema,
) {}
