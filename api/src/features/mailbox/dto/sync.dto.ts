import { z } from 'zod';

export const syncSchema = z.object({
  accountId: z.string().uuid().optional(),
  mailbox: z.string().min(1).max(255).default('INBOX'),
});
export type SyncDto = z.infer<typeof syncSchema>;
