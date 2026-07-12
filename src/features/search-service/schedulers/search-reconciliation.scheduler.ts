import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { IndexRegistry } from '../index-registry';
import { SEARCH_INDEXING_QUEUE, SEARCH_REINDEX_JOB } from '../search.constants';

/**
 * Registers a repeatable full-reindex sweep per index that declares a rebuild
 * source — the drift-repair path (Postgres is the source of truth; Meili is a
 * rebuildable read model). Not called at boot (mirrors FileReconciliationScheduler);
 * invoke `scheduleReconciliation` from an ops/bootstrap hook once Redis is up.
 */
@Injectable()
export class SearchReconciliationScheduler {
  constructor(
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    private readonly registry: IndexRegistry,
  ) {}

  async scheduleReconciliation(everyMs = 86_400_000): Promise<void> {
    for (const def of this.registry.all()) {
      if (!def.source) continue;
      await this.queue.add(
        SEARCH_REINDEX_JOB,
        { index: def.name },
        {
          repeat: { every: everyMs },
          jobId: `reindex:${def.name}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }
  }
}
