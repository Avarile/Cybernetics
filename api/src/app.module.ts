import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import type { AuthConfig } from './config/configurations/auth.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { RolesGuard } from './common/guards/roles.guard';
import { CacheModule } from './infrastructure/cache/cache.module';
import { SessionCacheModule } from './infrastructure/cache/session/session-cache.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ExceptionsModule } from './infrastructure/exceptions';
import { FileManageModule } from './infrastructure/file-manage/file-manage.module';
import { HealthModule } from './infrastructure/health/health.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { ObservabilityModule } from './infrastructure/observability/sentry.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { SearchEngineModule } from './infrastructure/search-engine/search-engine.module';
import { AuthModule } from './features/auth/auth.module';
import { FileProcessorModule } from './features/file-processor/file-processor.module';
import { MailboxModule } from './features/mailbox/mailbox.module';
import { MastraModule } from './features/mastra/mastra.module';
import { SearchServiceModule } from './features/search-service/search-service.module';
import { SystemModule } from './features/system/system.module';
import { UsersModule } from './features/users/users.module';

/**
 * Composition root. Import order is load-bearing:
 *  - ObservabilityModule (Sentry) is first so instrumentation wraps everything.
 *  - MastraModule is last because its catch-all controller would otherwise
 *    intercept unrelated routes.
 *
 * Global guards run in registration order: throttle → authenticate → authorize.
 */
@Module({
  imports: [
    ObservabilityModule,
    ConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AuthConfig>('auth');
        return [{ ttl: auth.throttleTtl * 1000, limit: auth.throttleLimit }];
      },
    }),

    LoggerModule,
    ExceptionsModule,
    DatabaseModule,
    CacheModule,
    SessionCacheModule,
    QueueModule,
    FileManageModule,
    SearchEngineModule,
    HealthModule,

    // Feature modules.
    AuthModule,
    UsersModule,
    FileProcessorModule,
    SearchServiceModule,
    SystemModule,
    MailboxModule,

    // Mastra AI — must remain last.
    MastraModule,
  ],
  providers: [
    // Validates every handler param typed as a `createZodDto` class, throwing the
    // app's AppException(VALIDATION_FAILED) → ErrorEnvelope. Non-DTO params pass
    // through untouched.
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
