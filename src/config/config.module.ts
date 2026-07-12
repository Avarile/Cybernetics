import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { appConfig } from './configurations/app.config';
import { databaseConfig } from './configurations/database.config';
import { redisConfig } from './configurations/redis.config';
import { sentryConfig } from './configurations/sentry.config';
import { storageConfig } from './configurations/storage.config';
import { validateEnv } from './env.validation';

/**
 * Global configuration module.
 *
 * - Loads `.env` and validates/coerces every variable with Zod at boot
 *   (fails fast on invalid config).
 * - Exposes namespaced, strongly-typed config objects (`app`, `database`,
 *   `redis`, `sentry`) that other modules inject instead of raw `process.env`.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      validate: validateEnv,
      load: [appConfig, databaseConfig, redisConfig, sentryConfig, storageConfig],
    }),
  ],
})
export class ConfigModule {}
