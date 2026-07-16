import { z } from 'zod';
export const serviceTokenSchema = z.object({ apiKey: z.string().min(1) });
export type ServiceTokenDto = z.infer<typeof serviceTokenSchema>;
