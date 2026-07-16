import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

export const redisConfig = registerAs('redis', () => {
  const env = validateEnv(process.env);
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
  };
});

export type RedisConfig = ReturnType<typeof redisConfig>;
