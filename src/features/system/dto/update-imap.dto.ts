import { z } from 'zod';
import { createImapSchema } from './create-imap.dto';

export const updateImapSchema = createImapSchema.partial();

export type UpdateImapDto = z.infer<typeof updateImapSchema>;
