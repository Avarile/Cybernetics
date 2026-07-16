import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  SentryModule as SentryCoreModule,
  SentryGlobalFilter,
} from '@sentry/nestjs/setup';

/**
 * Wires Sentry into the Nest request lifecycle.
 *
 * `SentryModule.forRoot()` is imported from `@sentry/nestjs/setup` (NOT the
 * package root) so that `@nestjs/common` is loaded after OpenTelemetry patches
 * it — importing from the root would break auto-instrumentation.
 *
 * `SentryGlobalFilter` is registered as the first `APP_FILTER` so unhandled
 * exceptions are reported to Sentry before any other exception filter runs.
 * The actual `Sentry.init()` lives in `src/instrument.ts`.
 */
@Module({
  imports: [SentryCoreModule.forRoot()],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class ObservabilityModule {}
