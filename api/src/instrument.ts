import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

/**
 * Sentry initialization.
 *
 * MUST be imported before anything else (it is the first import in `main.ts`)
 * so the SDK can patch libraries before NestJS loads them. This file runs
 * before `ConfigModule` loads `.env`, so it reads real environment variables
 * directly and no-ops when no DSN is present (e.g. local development).
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    profilesSampleRate: Number(
      process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.1',
    ),
    integrations: [nodeProfilingIntegration()],
  });
}
