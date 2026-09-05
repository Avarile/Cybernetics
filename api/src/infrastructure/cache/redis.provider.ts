import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { RedisConfig } from '../../config/configurations/redis.config';

/** DI token for the shared raw ioredis client. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Shared ioredis client, reused by the session cache and health check.
 * (BullMQ manages its own connection from the same config.)
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const redis = config.getOrThrow<RedisConfig>('redis');
    return new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password,
      db: redis.db,
      // Bound how long a command can be in flight. Without this, ioredis'
      // defaults (`enableOfflineQueue: true`, 20 retries) mean a command issued
      // while Redis is unreachable neither resolves nor rejects — it queues.
      // Callers on a request path then hang instead of failing, which is why
      // `SessionCacheService` also races every command against `withTimeout`.
      commandTimeout: 1_000,
      maxRetriesPerRequest: 3,
    });
  },
};

/** Closes the shared client on graceful shutdown. */
@Injectable()
export class RedisClientLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit();
  }
}
