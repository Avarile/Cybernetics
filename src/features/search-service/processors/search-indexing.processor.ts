import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { SEARCH_ENGINE } from '../../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../../infrastructure/search-engine/search-engine.interface';
import { IndexRegistry } from '../index-registry';
import {
  SEARCH_DELETE_DOCS_JOB,
  SEARCH_INDEXING_QUEUE,
  SEARCH_INDEX_DOCS_JOB,
  SEARCH_REINDEX_JOB,
} from '../search.constants';

/**
 * Consumes the `search-indexing` queue. Each job applies its mutation via
 * SEARCH_ENGINE and awaits the Meili task so a job only succeeds once the index
 * has actually converged. Idempotent: documents are keyed by primary key.
 */
@Processor(SEARCH_INDEXING_QUEUE)
export class SearchIndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchIndexingProcessor.name);

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly registry: IndexRegistry,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case SEARCH_INDEX_DOCS_JOB: {
        const { index, docs } = job.data as {
          index: string;
          docs: Array<Record<string, unknown>>;
        };
        const { taskUid } = await this.engine.addOrReplace(index, docs);
        await this.engine.waitForTask(taskUid);
        break;
      }
      case SEARCH_DELETE_DOCS_JOB: {
        const { index, ids } = job.data as { index: string; ids: string[] };
        const { taskUid } = await this.engine.deleteDocuments(index, ids);
        await this.engine.waitForTask(taskUid);
        break;
      }
      case SEARCH_REINDEX_JOB: {
        const { index } = job.data as { index: string };
        await this.reindex(index);
        break;
      }
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }

  private async reindex(index: string): Promise<void> {
    const def = this.registry.get(index);
    if (!def?.source) {
      this.logger.warn(`Reindex "${index}" skipped: no source registered`);
      return;
    }
    const docs = await def.source();
    const cleared = await this.engine.clearIndex(index);
    await this.engine.waitForTask(cleared.taskUid);
    if (docs.length) {
      const added = await this.engine.addOrReplace(index, docs);
      await this.engine.waitForTask(added.taskUid);
    }
    this.logger.log(`Reindexed "${index}" with ${docs.length} documents`);
  }
}
