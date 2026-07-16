import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RedisConfig } from '../../config/configurations/redis.config';
import { ExampleProcessor } from './processors/example.processor';
import { DEFAULT_QUEUE } from './queue.constants';
import { ExampleScheduler } from './schedulers/example.scheduler';

/**
 * BullMQ infrastructure. `forRootAsync` sets the shared Redis connection;
 * `registerQueue` declares the default queue. Processors (`WorkerHost`) consume
 * jobs; schedulers enqueue delayed/repeatable jobs.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = config.getOrThrow<RedisConfig>('redis');
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
            db: redis.db,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: DEFAULT_QUEUE }),
  ],
  providers: [ExampleProcessor, ExampleScheduler],
  exports: [BullModule],
})
export class QueueModule {}
