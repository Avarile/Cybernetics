import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { SearchConfig } from '../../config/configurations/search.config';
import { ErrorCode, ExceptionService } from '../../infrastructure/exceptions';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import {
  SearchEngineError,
  type SearchEngine,
} from '../../infrastructure/search-engine/search-engine.interface';
import { validateDocument } from './document-validator';
import { IndexRegistry, type CompiledCollection } from './index-registry';
import { SearchRecordRepository } from './search-record.repository';
import {
  DELETE_RECORD_JOB,
  INDEX_RECORD_JOB,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from './search.constants';
import type {
  IndexState,
  SearchFilterValue,
  SearchRequest,
  SearchResults,
} from './search.types';
import { computeChecksum, INDEXING_JOB_OPTS } from './search.util';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordInput {
  externalId?: string;
  document: Record<string, unknown>;
}

export interface PersistResult {
  id: string;
  externalId: string | null;
  indexState: IndexState;
}

/**
 * Owns record persistence and querying. Writes go to Postgres (source of truth)
 * then enqueue an async index job; queries hit Meili only. Reads are global —
 * authorization is enforced by the controller's role guards.
 */
@Injectable()
export class SearchRecordService {
  private readonly logger = new Logger(SearchRecordService.name);
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly records: SearchRecordRepository,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
    private readonly errors: ExceptionService,
  ) {
    const cfg = config.getOrThrow<SearchConfig>('search');
    this.defaultPageSize = cfg.defaultPageSize;
    this.maxPageSize = cfg.maxPageSize;
  }

  async persist(
    collection: string,
    inputs: RecordInput[],
  ): Promise<PersistResult[]> {
    const def = await this.requireCollection(collection);

    // Validate every document first — no partial writes on a bad record.
    for (const [i, input] of inputs.entries()) {
      const errors = validateDocument(def.fields, input.document);
      if (errors.length) {
        throw this.errors.validation(
          errors.map((m) => ({ path: `records[${i}]`, message: m })),
          { message: `Record ${i} failed validation` },
        );
      }
    }

    const results: PersistResult[] = [];
    const toIndex: string[] = [];
    for (const input of inputs) {
      const externalId = input.externalId ?? null;
      const checksum = computeChecksum(externalId, input.document);

      if (externalId) {
        const existing = await this.records.findLiveByExternalId(
          collection,
          externalId,
        );
        if (existing) {
          if (
            existing.checksum === checksum &&
            existing.indexState === 'INDEXED'
          ) {
            results.push({
              id: existing.id,
              externalId: existing.externalId,
              indexState: existing.indexState,
            });
            continue;
          }
          const updated = await this.records.update(existing.id, {
            document: input.document,
            checksum,
            indexState: 'PENDING',
            indexError: null,
          });
          const row = updated ?? existing;
          toIndex.push(row.id);
          results.push({ id: row.id, externalId, indexState: 'PENDING' });
          continue;
        }
      }

      const row = await this.records.create({
        collection,
        externalId,
        document: input.document,
        checksum,
        indexState: 'PENDING',
      });
      toIndex.push(row.id);
      results.push({ id: row.id, externalId, indexState: 'PENDING' });
    }

    for (const id of toIndex) {
      await this.queue.add(INDEX_RECORD_JOB, { id }, INDEXING_JOB_OPTS);
    }
    return results;
  }

  async remove(collection: string, key: string): Promise<void> {
    await this.requireCollection(collection);
    let row = UUID_RE.test(key) ? await this.records.findLiveById(key) : null;
    if (!row) row = await this.records.findLiveByExternalId(collection, key);
    if (!row || row.collection !== collection) {
      throw this.errors.create(ErrorCode.SEARCH_RECORD_NOT_FOUND);
    }
    await this.records.softDelete(row.id);
    await this.queue.add(
      DELETE_RECORD_JOB,
      { collection, id: row.id },
      INDEXING_JOB_OPTS,
    );
  }

  async reload(collection: string): Promise<void> {
    await this.requireCollection(collection);
    await this.queue.add(
      REINDEX_COLLECTION_JOB,
      { collection },
      INDEXING_JOB_OPTS,
    );
  }

  async search<T = Record<string, unknown>>(
    collection: string,
    request: SearchRequest,
  ): Promise<SearchResults<T>> {
    const def = await this.requireCollection(collection);
    const hitsPerPage = Math.min(
      request.limit ?? this.defaultPageSize,
      this.maxPageSize,
    );
    const filter = this.buildFilter(def, request.filters);
    const sort = this.buildSort(def, request.sort);

    try {
      const result = await this.engine.search<T>(collection, {
        q: request.q,
        filter: filter.length ? filter : undefined,
        sort: sort.length ? sort : undefined,
        facets: this.pickFacets(def, request.facets),
        page: request.page,
        hitsPerPage,
        attributesToHighlight: request.highlight,
      });
      return {
        hits: result.hits,
        page: result.page,
        limit: result.hitsPerPage,
        totalHits: result.totalHits,
        totalPages: result.totalPages,
        facetDistribution: result.facetDistribution,
        processingTimeMs: result.processingTimeMs,
      };
    } catch (error) {
      if (error instanceof SearchEngineError) {
        this.logger.warn(`Search failed on "${collection}": ${error.message}`);
        throw this.errors.create(ErrorCode.SEARCH_UNAVAILABLE, {
          cause: error,
        });
      }
      throw error;
    }
  }

  private async requireCollection(name: string): Promise<CompiledCollection> {
    const def = await this.registry.resolve(name);
    if (!def) {
      throw this.errors.create(ErrorCode.SEARCH_COLLECTION_NOT_FOUND, {
        message: `Unknown collection "${name}"`,
      });
    }
    return def;
  }

  private buildFilter(
    def: CompiledCollection,
    filters?: Record<string, SearchFilterValue>,
  ): string[] {
    const clauses: string[] = [];
    for (const [field, value] of Object.entries(filters ?? {})) {
      if (!def.definition.filterableAttributes.includes(field)) {
        throw this.errors.create(ErrorCode.SEARCH_QUERY_INVALID, {
          message: `Unknown filter field "${field}"`,
        });
      }
      clauses.push(toFilterClause(field, value));
    }
    return clauses;
  }

  private buildSort(def: CompiledCollection, sort?: string[]): string[] {
    if (!sort) return [];
    return sort.map((entry) => {
      const [field, dir] = entry.split(':');
      if (
        !def.definition.sortableAttributes.includes(field) ||
        (dir !== 'asc' && dir !== 'desc')
      ) {
        throw this.errors.create(ErrorCode.SEARCH_QUERY_INVALID, {
          message: `Invalid sort "${entry}"`,
        });
      }
      return `${field}:${dir}`;
    });
  }

  private pickFacets(
    def: CompiledCollection,
    facets?: string[],
  ): string[] | undefined {
    if (!facets) return undefined;
    const invalid = facets.filter(
      (f) => !def.definition.filterableAttributes.includes(f),
    );
    if (invalid.length) {
      throw this.errors.create(ErrorCode.SEARCH_QUERY_INVALID, {
        message: `Unknown facet(s): ${invalid.join(', ')}`,
      });
    }
    return facets;
  }
}

/** Quote + escape a string value for a Meili filter expression. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Build one Meili filter clause from a validated field/value pair. */
function toFilterClause(field: string, value: SearchFilterValue): string {
  if (Array.isArray(value)) {
    const list = value
      .map((v) => (typeof v === 'number' ? String(v) : quote(String(v))))
      .join(', ');
    return `${field} IN [${list}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${field} = ${value}`;
  }
  return `${field} = ${quote(value)}`;
}
