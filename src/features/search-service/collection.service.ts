import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../infrastructure/search-engine/search-engine.interface';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import { CollectionRepository } from './collection.repository';
import { fieldSpecToIndexDefinition } from './document-validator';
import { IndexRegistry } from './index-registry';
import { SearchRecordRepository } from './search-record.repository';
import { REINDEX_COLLECTION_JOB, SEARCH_INDEXING_QUEUE } from './search.constants';
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
  ) {}

  /** Warm the registry and converge Meili settings at boot (best-effort). */
  async onApplicationBootstrap(): Promise<void> {
    let compiled;
    try {
      compiled = await this.registry.warm();
    } catch (error) {
      this.logger.warn(`Failed to warm collection registry: ${asMessage(error)}`);
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

  async create(input: CreateCollectionInput): Promise<CollectionView> {
    if (await this.collections.findByName(input.name)) {
      throw new ConflictException(`Collection "${input.name}" already exists`);
    }
    await this.engine.ensureIndex(
      fieldSpecToIndexDefinition(input.name, input.fields),
    );
    const row = await this.collections.create({
      name: input.name,
      displayName: input.displayName,
      description: input.description ?? null,
      fields: input.fields,
    });
    return toView(row);
  }

  async list(): Promise<CollectionView[]> {
    const rows = await this.collections.listActive();
    return rows.map(toView);
  }

  async get(name: string): Promise<CollectionView> {
    const row = await this.collections.findByName(name);
    if (!row) throw new NotFoundException(`Unknown collection "${name}"`);
    return toView(row);
  }

  async update(
    name: string,
    input: UpdateCollectionInput,
  ): Promise<CollectionView> {
    const existing = await this.collections.findByName(name);
    if (!existing) throw new NotFoundException(`Unknown collection "${name}"`);

    if (input.fields) {
      await this.engine.ensureIndex(
        fieldSpecToIndexDefinition(name, input.fields),
      );
    }
    const row = await this.collections.updateByName(name, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.fields !== undefined ? { fields: input.fields } : {}),
    });
    if (!row) throw new NotFoundException(`Unknown collection "${name}"`);
    this.registry.invalidate(name);

    if (input.fields) {
      await this.queue.add(
        REINDEX_COLLECTION_JOB,
        { collection: name },
        INDEXING_JOB_OPTS,
      );
    }
    return toView(row);
  }

  async remove(name: string): Promise<void> {
    const existing = await this.collections.findByName(name);
    if (!existing) throw new NotFoundException(`Unknown collection "${name}"`);
    await this.collections.softDeleteByName(name);
    await this.records.softDeleteByCollection(name);
    this.registry.invalidate(name);
    try {
      await this.engine.deleteIndex(name);
    } catch (error) {
      this.logger.warn(`Failed to delete index "${name}": ${asMessage(error)}`);
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
