import { z } from 'zod';

export const chatSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(8000),
});

export type ChatDto = z.infer<typeof chatSchema>;
