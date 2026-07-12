import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { FILE_PROCESSING_QUEUE, FILE_RECONCILE_JOB } from '../file.constants';

/**
 * Registers the repeatable reconciliation sweep (expire stale PENDING rows,
 * purge unreferenced objects). Not called at boot — mirroring the queue module's
 * ExampleScheduler — so booting never requires Redis. Invoke `scheduleReconciliation`
 * from an ops/bootstrap hook once Redis is available.
 */
@Injectable()
export class FileReconciliationScheduler {
  constructor(
    @InjectQueue(FILE_PROCESSING_QUEUE) private readonly queue: Queue,
  ) {}

  async scheduleReconciliation(everyMs = 3_600_000): Promise<void> {
    await this.queue.add(
      FILE_RECONCILE_JOB,
      {},
      {
        repeat: { every: everyMs },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
