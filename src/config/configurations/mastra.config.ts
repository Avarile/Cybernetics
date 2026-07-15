import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/** Namespaced config for the Mastra AI agent module. */
export const mastraConfig = registerAs('mastra', () => {
  const env = validateEnv(process.env);
  return {
    aiGatewayApiKey: env.AI_GATEWAY_API_KEY,
    model: env.MASTRA_MODEL,
    maxRetries: env.MASTRA_MAX_RETRIES,
    memoryLastMessages: env.MASTRA_MEMORY_LAST_MESSAGES,
    approvalTtlMs: env.MASTRA_APPROVAL_TTL_MS,
    schedulesEnabled: env.MASTRA_SCHEDULES_ENABLED,
  };
});

export type MastraConfig = ReturnType<typeof mastraConfig>;
