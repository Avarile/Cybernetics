import { z } from 'zod';

export const createIntegrationSchema = z.object({
  provider: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  kind: z.enum(['api_key', 'oauth2', 'basic', 'bearer']).default('api_key'),
  secret: z.string().min(1).max(1024),
  meta: z.record(z.string(), z.unknown()).default({}),
  expiresAt: z.coerce.date().optional(),
});

export type CreateIntegrationDto = z.infer<typeof createIntegrationSchema>;
