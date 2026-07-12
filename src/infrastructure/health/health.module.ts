import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health';
import { HealthController } from './health.controller';
import { MeiliHealthIndicator } from './meili.health';
import { MinioHealthIndicator } from './minio.health';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    DatabaseHealthIndicator,
    RedisHealthIndicator,
    MinioHealthIndicator,
    MeiliHealthIndicator,
  ],
})
export class HealthModule {}
