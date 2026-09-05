import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { withTimeout } from '../../../common/with-timeout';
import { REDIS_CLIENT } from '../redis.provider';

/**
 * Ceiling on a single Redis round-trip.
 *
 * Load-bearing, not a nicety. `redisClientProvider` builds ioredis with
 * defaults, so `enableOfflineQueue` is on: while the server is unreachable a
 * command is **queued rather than rejected** — it neither resolves nor throws.
 * Since this cache sits on the authenticated request path, awaiting it
 * unguarded would turn a Redis outage into hung requests rather than failed
 * ones, and no caller can react to a promise that never settles.
 */
const COMMAND_TIMEOUT_MS = 200;

/**
 * Stores and retrieves session data in Redis. Keys are namespaced under
 * `session:` and carry a TTL.
 *
 * Consumed by `TokenValidityService` to cache the "is this token still good?"
 * verdict. Because the cache lives in shared Redis rather than in each
 * process's memory, deleting a key on revocation takes effect across every
 * instance at once — no pub/sub, unlike `IndexRegistry`, which caches locally.
 *
 * Every method rejects rather than hangs when Redis is unreachable; deciding
 * what that means is the caller's business (`TokenValidityService` fails
 * closed on a read, and shrugs at a failed write).
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
    await withTimeout(
      this.redis.set(
        this.key(sessionId),
        JSON.stringify(data),
        'EX',
        ttlSeconds,
      ),
      COMMAND_TIMEOUT_MS,
    );
  }

  /** Returns parsed session data, or `null` if absent/expired. */
  async get<T = Record<string, unknown>>(sessionId: string): Promise<T | null> {
    const raw = await withTimeout(
      this.redis.get(this.key(sessionId)),
      COMMAND_TIMEOUT_MS,
    );
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /** Refreshes the TTL (seconds) on an existing session. */
  async touch(sessionId: string, ttlSeconds: number): Promise<void> {
    await withTimeout(
      this.redis.expire(this.key(sessionId), ttlSeconds),
      COMMAND_TIMEOUT_MS,
    );
  }

  /** Removes a session (e.g. on logout or revocation). */
  async destroy(sessionId: string): Promise<void> {
    await withTimeout(this.redis.del(this.key(sessionId)), COMMAND_TIMEOUT_MS);
  }
}
