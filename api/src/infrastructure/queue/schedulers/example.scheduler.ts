import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DEFAULT_QUEUE } from '../queue.constants';

/**
 * Registers scheduled / repeatable jobs. BullMQ handles delayed and repeatable
 * scheduling natively.
 *
 * The example repeatable registration is left commented so the app does not
 * enqueue work (and thus require a live Redis) merely by booting. Uncomment
 * and call from a lifecycle hook once Redis is available.
 */
@Injectable()
export class ExampleScheduler {
  constructor(@InjectQueue(DEFAULT_QUEUE) private readonly queue: Queue) {}

  async scheduleHeartbeat(): Promise<void> {
    await this.queue.add(
      'heartbeat',
      {},
      { repeat: { every: 60_000 }, removeOnComplete: true },
    );
  }
}
