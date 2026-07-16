import { Module } from '@nestjs/common';
import { SessionCacheService } from './session-cache.service';

/**
 * Provides `SessionCacheService`. Relies on the globally-exported
 * `REDIS_CLIENT` from `CacheModule`.
 */
@Module({
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
