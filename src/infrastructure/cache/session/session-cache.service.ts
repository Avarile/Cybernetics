import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis.provider';

/**
 * Stores and retrieves user session data in Redis. Used primarily by
 * authentication. Keys are namespaced under `session:` and carry a TTL.
 */
@Injectable()
export class SessionCacheService {
  private readonly prefix = 'session:';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(sessionId: string): string {
    return `${this.prefix}${sessionId}`;
  }

  /** Stores session data with a TTL (seconds). */
  async set(
    sessionId: string,
    data: Record<string, unknown>,
    ttlSeconds: number,
  ): Promise<void> {
    await this.redis.set(
      this.key(sessionId),
      JSON.stringify(data),
      'EX',
      ttlSeconds,
    );
  }

  /** Returns parsed session data, or `null` if absent/expired. */
  async get<T = Record<string, unknown>>(
    sessionId: string,
  ): Promise<T | null> {
    const raw = await this.redis.get(this.key(sessionId));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /** Refreshes the TTL (seconds) on an existing session. */
  async touch(sessionId: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(this.key(sessionId), ttlSeconds);
  }

  /** Removes a session (e.g. on logout). */
  async destroy(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }
}
