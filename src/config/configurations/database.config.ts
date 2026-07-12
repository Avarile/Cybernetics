import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

export const databaseConfig = registerAs('database', () => {
  const env = validateEnv(process.env);
  return {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    username: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    database: env.DATABASE_NAME,
    ssl: env.DATABASE_SSL,
    logging: env.DATABASE_LOGGING,
  };
});

export type DatabaseConfig = ReturnType<typeof databaseConfig>;
