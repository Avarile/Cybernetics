import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { SessionCacheModule } from './infrastructure/cache/session/session-cache.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { FileManageModule } from './infrastructure/file-manage/file-manage.module';
import { HealthModule } from './infrastructure/health/health.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { ObservabilityModule } from './infrastructure/observability/sentry.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { FileProcessorModule } from './features/file-processor/file-processor.module';
import { MastraModule } from './features/mastra/mastra.module';

/**
 * Composition root. Import order is load-bearing:
 *  - ObservabilityModule (Sentry) is first so instrumentation wraps everything.
 *  - MastraModule is last because its catch-all controller would otherwise
 *    intercept unrelated routes.
 */
@Module({
  imports: [
    // Observability (Sentry) — first.
    ObservabilityModule,

    // Configuration (global, validated).
    ConfigModule,

    // Infrastructure.
    LoggerModule,
    DatabaseModule,
    CacheModule,
    SessionCacheModule,
    QueueModule,
    FileManageModule,
    HealthModule,

    // Feature modules (application layer goes here as it grows).
    FileProcessorModule,

    // Mastra AI — must remain last.
    MastraModule,
  ],
})
export class AppModule {}
