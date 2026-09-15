import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listConversationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  /** 'all' is for callers that want both shelves in one page. */
  status: z.enum(['active', 'archived', 'all']).default('active'),
});

export class ListConversationsDto extends createZodDto(
  listConversationsSchema,
) {}
