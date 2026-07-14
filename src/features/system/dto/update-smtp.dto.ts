import { createSmtpSchema } from './create-smtp.dto';
import { z } from 'zod';

export const updateSmtpSchema = createSmtpSchema.partial();

export type UpdateSmtpDto = z.infer<typeof updateSmtpSchema>;
