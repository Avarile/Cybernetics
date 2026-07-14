import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RECONCILE_JOB, SEARCH_INDEXING_QUEUE } from '../search.constants';

/**
 * Registers a repeatable `reconcile` sweep. The processor consumes it and
 * re-enqueues any record that never converged (PENDING/FAILED beyond a
 * threshold) — the drift-repair path, since Postgres is the source of truth and
 * Meili is a rebuildable read model. Invoke `scheduleReconciliation` from an
 * ops/bootstrap hook once Redis is up (mirrors FileReconciliationScheduler).
 */
@Injectable()
export class SearchReconciliationScheduler {
  constructor(
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
  ) {}

  async scheduleReconciliation(everyMs = 86_400_000): Promise<void> {
    await this.queue.add(
      RECONCILE_JOB,
      {},
      {
        repeat: { every: everyMs },
        jobId: 'search-reconcile',
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
