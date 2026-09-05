import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../infrastructure/search-engine/search-engine.interface';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import { CollectionRepository } from './collection.repository';
import { fieldSpecToIndexDefinition } from './document-validator';
import { IndexRegistry } from './index-registry';
import { SearchRecordRepository } from './search-record.repository';
import {
  DROP_INDEX_JOB,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from './search.constants';
import { INDEXING_JOB_OPTS } from './search.util';

/** A collection as returned to API callers. */
export interface CollectionView {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCollectionInput {
  name: string;
  displayName: string;
  description?: string;
  fields: FieldSpec[];
}

export interface UpdateCollectionInput {
  displayName?: string;
  description?: string | null;
  fields?: FieldSpec[];
}

/**
 * Manages the lifecycle of dynamic collections: the DB row, the Meili index +
 * settings, and the registry cache. Structural field-spec validation happens at
 * the DTO boundary; this service owns identity + Meili convergence.
 */
@Injectable()
export class CollectionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly collections: CollectionRepository,
    private readonly records: SearchRecordRepository,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    private readonly errors: ExceptionService,
  ) {}

  /** Warm the registry and converge Meili settings at boot (best-effort). */
  async onApplicationBootstrap(): Promise<void> {
    let compiled;
    try {
      compiled = await this.registry.warm();
    } catch (error) {
      this.logger.warn(
        `Failed to warm collection registry: ${asMessage(error)}`,
      );
      return;
    }
    for (const def of compiled) {
      try {
        await this.engine.ensureIndex(def.definition);
      } catch (error) {
        this.logger.warn(
          `Failed to ensure index "${def.name}": ${asMessage(error)}`,
        );
      }
    }
  }

  /**
   * Postgres row first, Meili index second. The reverse order — which this used
   * to do — orphans an index whenever the insert fails, and contradicts the rule
   * that Postgres is the source of truth. If `ensureIndex` fails the collection
   * still exists and its settings converge on the next write or the next boot.
   */
  async create(input: CreateCollectionInput): Promise<CollectionView> {
    if (await this.collections.findByName(input.name)) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_EXISTS, {
        message: `Collection "${input.name}" already exists`,
      });
    }
    const row = await this.collections.create({
      name: input.name,
      displayName: input.displayName,
      description: input.description ?? null,
      fields: input.fields,
    });
    await this.registry.invalidate(input.name);

    try {
      await this.engine.ensureIndex(
        fieldSpecToIndexDefinition(input.name, input.fields),
      );
      // A recycled name can inherit documents from a previous collection whose
      // index outlived it (e.g. a failed delete). Settings alone would not
      // remove them, so start the new collection from an empty index.
      const cleared = await this.engine.clearIndex(input.name);
      await this.engine.waitForTask(cleared.taskUid);
    } catch (error) {
      this.logger.warn(
        `Collection "${input.name}" created, but its index is not yet converged ` +
          `(will retry on next write/boot): ${asMessage(error)}`,
      );
    }
    return toView(row);
  }

  async list(): Promise<CollectionView[]> {
    const rows = await this.collections.listActive();
    return rows.map(toView);
  }

  async get(name: string): Promise<CollectionView> {
    const row = await this.collections.findByName(name);
    if (!row) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    return toView(row);
  }

  async update(
    name: string,
    input: UpdateCollectionInput,
  ): Promise<CollectionView> {
    const existing = await this.collections.findByName(name);
    if (!existing) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }

    if (input.fields) {
      await this.engine.ensureIndex(
        fieldSpecToIndexDefinition(name, input.fields),
      );
    }
    const row = await this.collections.updateByName(name, {
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.fields !== undefined ? { fields: input.fields } : {}),
    });
    if (!row) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    await this.registry.invalidate(name);

    if (input.fields) {
      await this.queue.add(
        REINDEX_COLLECTION_JOB,
        { collection: name },
        INDEXING_JOB_OPTS,
      );
    }
    return toView(row);
  }

  /**
   * Soft-delete the collection and its records, then drop the index. The records
   * are left `PENDING` and the drop is retried through the queue on failure, so
   * an index that outlives its collection is a transient state the pipeline
   * repairs rather than a silent orphan.
   */
  async remove(name: string): Promise<void> {
    const existing = await this.collections.findByName(name);
    if (!existing) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    await this.collections.softDeleteByName(name);
    await this.records.softDeleteByCollection(name);
    await this.registry.invalidate(name);
    try {
      const { taskUid } = await this.engine.deleteIndex(name);
      await this.engine.waitForTask(taskUid);
      // The documents are gone, so the soft-deleted rows have converged.
      await this.records.markCollectionPurged(name);
    } catch (error) {
      this.logger.warn(
        `Failed to delete index "${name}", queued for retry: ${asMessage(error)}`,
      );
      await this.queue
        .add(DROP_INDEX_JOB, { collection: name }, INDEXING_JOB_OPTS)
        .catch((queueError: unknown) =>
          this.logger.error(
            `Could not queue index drop for "${name}"; its documents remain ` +
              `searchable until an operator reloads or deletes the index: ${asMessage(queueError)}`,
          ),
        );
    }
  }
}

function toView(row: {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  createdAt: Date;
  updatedAt: Date;
}): CollectionView {
  return {
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    fields: row.fields,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
