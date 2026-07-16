import { z } from 'zod';

export const markSeenSchema = z.object({ seen: z.boolean() });
export type MarkSeenDto = z.infer<typeof markSeenSchema>;
