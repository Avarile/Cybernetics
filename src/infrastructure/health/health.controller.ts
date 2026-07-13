import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { DatabaseHealthIndicator } from './database.health';
import { MeiliHealthIndicator } from './meili.health';
import { MinioHealthIndicator } from './minio.health';
import { RedisHealthIndicator } from './redis.health';

/**
 * `GET /health` — liveness/readiness probe aggregating database, Redis, MinIO,
 * MeiliSearch, and heap-memory checks.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: DatabaseHealthIndicator,
    private readonly memory: MemoryHealthIndicator,
    private readonly redis: RedisHealthIndicator,
    private readonly minio: MinioHealthIndicator,
    private readonly meili: MeiliHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.isHealthy('database'),
      () => this.redis.isHealthy('redis'),
      () => this.minio.isHealthy('minio'),
      () => this.meili.isHealthy('meilisearch'),
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }
}
