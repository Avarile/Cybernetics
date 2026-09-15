import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AGENT_IDS } from '../mastra.constants';

export const chatStreamSchema = z
  .object({
    conversationId: z.string().uuid().optional(),
    /** Binds a NEW conversation to an agent; ignored on an existing one. */
    agentId: z.enum(AGENT_IDS).optional(),
    message: z.string().min(1).max(8000).optional(),
    resume: z
      .object({ approvalId: z.string().uuid(), approved: z.boolean() })
      .optional(),
  })
  .refine((v) => Boolean(v.message) !== Boolean(v.resume), {
    message: 'Provide exactly one of `message` or `resume`',
  });

export class ChatStreamDto extends createZodDto(chatStreamSchema) {}
