import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

export const appConfig = registerAs('app', () => {
  const env = validateEnv(process.env);
  return {
    name: env.APP_NAME,
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    isProduction: env.NODE_ENV === 'production',
  };
});

export type AppConfig = ReturnType<typeof appConfig>;
