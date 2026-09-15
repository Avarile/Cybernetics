import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/** Namespaced config for the Mastra AI agent module. */
export const mastraConfig = registerAs('mastra', () => {
  const env = validateEnv(process.env);
  return {
    // AI_GATEWAY_API_KEY wins; VERCEL_APIKEY is the alias the Vercel tooling
    // emits. `||` not `??` on purpose — the schema defaults both to '', so a
    // nullish coalesce would hand buildModel() an empty string. That is not a
    // no-op: `loadOptionalSetting` returns any string it is given before it
    // consults process.env, so '' silently disables auth rather than falling
    // back (see memory/model.factory.ts).
    aiGatewayApiKey: env.AI_GATEWAY_API_KEY || env.VERCEL_APIKEY,
    model: env.MASTRA_MODEL,
    maxRetries: env.MASTRA_MAX_RETRIES,
    memoryLastMessages: env.MASTRA_MEMORY_LAST_MESSAGES,
    approvalTtlMs: env.MASTRA_APPROVAL_TTL_MS,
    schedulesEnabled: env.MASTRA_SCHEDULES_ENABLED,
    runTimeoutMs: env.MASTRA_RUN_TIMEOUT_MS,
  };
});

export type MastraConfig = ReturnType<typeof mastraConfig>;
