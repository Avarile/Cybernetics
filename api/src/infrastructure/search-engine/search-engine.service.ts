import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MeiliSearch } from 'meilisearch';
import type { SearchConfig } from '../../config/configurations/search.config';
import { MEILI_CLIENT } from './meili.constants';
import {
  SearchEngineError,
  type EngineQuery,
  type EngineResult,
  type IndexDefinition,
  type SearchEngine,
  type TaskRef,
} from './search-engine.interface';

/**
 * MeiliSearch-backed implementation of {@link SearchEngine}. All MeiliSearch SDK
 * specifics are confined to this file — everything above it is index-agnostic.
 * Mutations return the async task ref so callers can await consistency.
 */
@Injectable()
export class SearchEngineService implements SearchEngine {
  private readonly logger = new Logger(SearchEngineService.name);
  private readonly prefix: string;
  private readonly taskTimeoutMs: number;
  private readonly maxTotalHits: number;

  constructor(
    @Inject(MEILI_CLIENT) private readonly client: MeiliSearch,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<SearchConfig>('search');
    this.prefix = cfg.indexPrefix;
    this.taskTimeoutMs = cfg.taskTimeoutMs;
    this.maxTotalHits = cfg.maxTotalHits;
  }

  private uid(index: string): string {
    return `${this.prefix}${index}`;
  }

  async ensureIndex(def: IndexDefinition): Promise<void> {
    const uid = this.uid(def.name);
    try {
      const task = await this.client.createIndex(uid, {
        primaryKey: def.primaryKey,
      });
      await this.waitForTask(task.taskUid);
    } catch (error) {
      if (!this.isAlreadyExists(error)) throw this.wrap(error);
    }
    const settings = await this.client.index(uid).updateSettings({
      searchableAttributes: def.searchableAttributes,
      filterableAttributes: def.filterableAttributes,
      sortableAttributes: def.sortableAttributes,
      ...(def.rankingRules ? { rankingRules: def.rankingRules } : {}),
      // Caps deep pagination: pages beyond this ceiling return nothing and
      // `totalHits` saturates, so it is configured rather than hardcoded and is
      // validated against SEARCH_MAX_PAGE_SIZE at startup.
      pagination: { maxTotalHits: def.maxTotalHits ?? this.maxTotalHits },
    });
    await this.waitForTask(settings.taskUid);
  }

  async indexExists(index: string): Promise<boolean> {
    try {
      await this.client.index(this.uid(index)).getRawInfo();
      return true;
    } catch (error) {
      if (errorCode(error) === 'index_not_found') return false;
      throw this.wrap(error);
    }
  }

  async addOrReplace(
    index: string,
    docs: Array<Record<string, unknown>>,
  ): Promise<TaskRef> {
    const task = await this.client.index(this.uid(index)).addDocuments(docs);
    return { taskUid: task.taskUid };
  }

  async update(
    index: string,
    docs: Array<Record<string, unknown>>,
  ): Promise<TaskRef> {
    const task = await this.client.index(this.uid(index)).updateDocuments(docs);
    return { taskUid: task.taskUid };
  }

  async deleteDocuments(index: string, ids: string[]): Promise<TaskRef> {
    const task = await this.client.index(this.uid(index)).deleteDocuments(ids);
    return { taskUid: task.taskUid };
  }

  async deleteByFilter(
    index: string,
    filter: string | string[],
  ): Promise<TaskRef> {
    const task = await this.client
      .index(this.uid(index))
      .deleteDocuments({ filter });
    return { taskUid: task.taskUid };
  }

  async clearIndex(index: string): Promise<TaskRef> {
    const task = await this.client.index(this.uid(index)).deleteAllDocuments();
    return { taskUid: task.taskUid };
  }

  async deleteIndex(index: string): Promise<TaskRef> {
    const task = await this.client.deleteIndex(this.uid(index));
    return { taskUid: task.taskUid };
  }

  async search<T = Record<string, unknown>>(
    index: string,
    query: EngineQuery,
  ): Promise<EngineResult<T>> {
    const res = (await this.client.index(this.uid(index)).search(query.q, {
      filter: query.filter,
      sort: query.sort,
      facets: query.facets,
      page: query.page,
      hitsPerPage: query.hitsPerPage,
      attributesToHighlight: query.attributesToHighlight,
      attributesToRetrieve: query.attributesToRetrieve,
    })) as {
      hits: T[];
      totalHits?: number;
      estimatedTotalHits?: number;
      totalPages?: number;
      hitsPerPage?: number;
      page?: number;
      facetDistribution?: Record<string, Record<string, number>>;
      processingTimeMs?: number;
    };
    return {
      hits: res.hits,
      totalHits: res.totalHits ?? res.estimatedTotalHits ?? res.hits.length,
      page: res.page ?? query.page ?? 1,
      hitsPerPage: res.hitsPerPage ?? query.hitsPerPage ?? res.hits.length,
      totalPages: res.totalPages ?? 1,
      facetDistribution: res.facetDistribution,
      processingTimeMs: res.processingTimeMs ?? 0,
    };
  }

  async waitForTask(taskUid: number): Promise<void> {
    // meilisearch@0.45.0: client.tasks.waitForTask(uid, { timeOutMs, intervalMs }).
    // The returned Task carries `.status` and `.error` (verified against the
    // installed 0.45.0 type definitions).
    const task = await this.client.tasks.waitForTask(taskUid, {
      timeOutMs: this.taskTimeoutMs,
    });
    if (task.status !== 'succeeded') {
      throw new SearchEngineError(
        `Meili task ${taskUid} ${task.status}: ${task.error?.message ?? 'unknown error'}`,
        task.error?.code,
      );
    }
  }

  async health(): Promise<boolean> {
    try {
      return await this.client.isHealthy();
    } catch {
      return false;
    }
  }

  private isAlreadyExists(error: unknown): boolean {
    return errorCode(error) === 'index_already_exists';
  }

  private wrap(error: unknown): SearchEngineError {
    const e = error as { message?: string };
    return new SearchEngineError(
      e?.message ?? 'search engine error',
      errorCode(error),
    );
  }
}

/**
 * Read a MeiliSearch error code from either shape it arrives in.
 *
 * `createIndex` returns a task that *fails*, which `waitForTask` converts into a
 * `SearchEngineError` carrying `code` directly. A synchronous REST rejection
 * instead throws a `MeiliSearchApiError`, whose code sits at `cause.code` — its
 * own enumerable keys are only `name`, `cause`, `response`. Reading just `.code`
 * silently misses the second case, which is how a deleted index was reported as
 * an unexpected failure rather than as "not found".
 */
function errorCode(error: unknown): string | undefined {
  const e = error as {
    code?: string;
    cause?: { code?: string };
  } | null;
  return e?.code ?? e?.cause?.code;
}
