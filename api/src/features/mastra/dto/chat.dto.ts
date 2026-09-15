import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AGENT_IDS } from '../mastra.constants';

export const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  /** Binds a NEW conversation to an agent; ignored on an existing one. */
  agentId: z.enum(AGENT_IDS).optional(),
  message: z.string().min(1).max(8000),
});

export class ChatDto extends createZodDto(chatSchema) {}
