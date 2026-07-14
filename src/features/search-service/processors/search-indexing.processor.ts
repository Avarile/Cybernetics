import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { SEARCH_ENGINE } from '../../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../../infrastructure/search-engine/search-engine.interface';
import { SearchRecordRepository } from '../search-record.repository';
import {
  DELETE_RECORD_JOB,
  INDEX_RECORD_JOB,
  RECONCILE_JOB,
  RECONCILE_STALE_MS,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from '../search.constants';
import { INDEXING_JOB_OPTS, toMeiliDocument } from '../search.util';

const REINDEX_PAGE_SIZE = 500;

/**
 * Applies index mutations off the request path. Every job reads the current row
 * from Postgres (the source of truth) so Meili converges to the latest state and
 * rapid updates coalesce. Success stamps `INDEXED`; a throw stamps `FAILED` and
 * rethrows so BullMQ retries.
 */
@Processor(SEARCH_INDEXING_QUEUE)
export class SearchIndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchIndexingProcessor.name);

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly records: SearchRecordRepository,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case INDEX_RECORD_JOB:
        return this.indexRecord(this.requireString(job, 'id', job.data?.id));
      case DELETE_RECORD_JOB:
        return this.deleteRecord(
          this.requireString(job, 'collection', job.data?.collection),
          this.requireString(job, 'id', job.data?.id),
        );
      case REINDEX_COLLECTION_JOB:
        return this.reindexCollection(
          this.requireString(job, 'collection', job.data?.collection),
        );
      case RECONCILE_JOB:
        return this.reconcile();
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }

  private async indexRecord(id: string): Promise<void> {
    const row = await this.records.findById(id);
    if (!row) return;
    try {
      if (row.isDeleted) {
        const { taskUid } = await this.engine.deleteDocuments(row.collection, [id]);
        await this.engine.waitForTask(taskUid);
      } else {
        const { taskUid } = await this.engine.addOrReplace(row.collection, [
          toMeiliDocument(row),
        ]);
        await this.engine.waitForTask(taskUid);
      }
      await this.records.markIndexState(id, 'INDEXED', {
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (error) {
      await this.records.markIndexState(id, 'FAILED', {
        indexError: asMessage(error),
      });
      throw error;
    }
  }

  private async deleteRecord(collection: string, id: string): Promise<void> {
    try {
      const { taskUid } = await this.engine.deleteDocuments(collection, [id]);
      await this.engine.waitForTask(taskUid);
      await this.records.markIndexState(id, 'INDEXED', {
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (error) {
      await this.records.markIndexState(id, 'FAILED', {
        indexError: asMessage(error),
      });
      throw error;
    }
  }

  private async reindexCollection(collection: string): Promise<void> {
    const cleared = await this.engine.clearIndex(collection);
    await this.engine.waitForTask(cleared.taskUid);

    let afterId: string | null = null;
    let total = 0;
    for (;;) {
      const page = await this.records.pageLiveByCollection(
        collection,
        REINDEX_PAGE_SIZE,
        afterId,
      );
      if (page.length === 0) break;
      const added = await this.engine.addOrReplace(
        collection,
        page.map(toMeiliDocument),
      );
      await this.engine.waitForTask(added.taskUid);
      total += page.length;
      afterId = page[page.length - 1].id;
      if (page.length < REINDEX_PAGE_SIZE) break;
    }
    await this.records.markCollectionIndexed(collection);
    this.logger.log(`Reindexed "${collection}" with ${total} documents`);
  }

  private async reconcile(): Promise<void> {
    const cutoff = new Date(Date.now() - RECONCILE_STALE_MS);
    const rows = await this.records.findUnsynced(cutoff, 500);
    for (const row of rows) {
      if (row.isDeleted) {
        await this.queue.add(
          DELETE_RECORD_JOB,
          { collection: row.collection, id: row.id },
          INDEXING_JOB_OPTS,
        );
      } else {
        await this.queue.add(INDEX_RECORD_JOB, { id: row.id }, INDEXING_JOB_OPTS);
      }
    }
    if (rows.length) this.logger.log(`Reconcile re-enqueued ${rows.length} records`);
  }

  private requireString(job: Job, field: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Job "${job.name}": "${field}" must be a non-empty string`);
    }
    return value;
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
