import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { Principal } from '../../common/principal';
import type { SearchConfig } from '../../config/configurations/search.config';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import {
  SearchEngineError,
  type SearchEngine,
} from '../../infrastructure/search-engine/search-engine.interface';
import { IndexRegistry, type RegisteredIndex } from './index-registry';
import {
  SEARCH_DELETE_DOCS_JOB,
  SEARCH_INDEXING_QUEUE,
  SEARCH_INDEX_DOCS_JOB,
  SEARCH_REINDEX_JOB,
} from './search.constants';
import type {
  IndexName,
  SearchFilterValue,
  SearchRequest,
  SearchResults,
} from './search.types';

/**
 * Search-service. Internal callers (agents / pipeline, via SYSTEM_PRINCIPAL)
 * and the controller both use `search`; ownership is enforced here so a user
 * can never widen their scope. Indexing is enqueued (async, idempotent).
 */
@Injectable()
export class SearchService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SearchService.name);
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<SearchConfig>('search');
    this.defaultPageSize = cfg.defaultPageSize;
    this.maxPageSize = cfg.maxPageSize;
  }

  /** Best-effort settings convergence at boot; never blocks startup on Meili. */
  async onApplicationBootstrap(): Promise<void> {
    for (const def of this.registry.all()) {
      try {
        await this.engine.ensureIndex(def);
      } catch (error) {
        this.logger.warn(
          `Failed to ensure index "${def.name}": ${(error as Error).message}`,
        );
      }
    }
  }

  async search<T = Record<string, unknown>>(
    index: IndexName,
    request: SearchRequest,
    principal: Principal,
  ): Promise<SearchResults<T>> {
    const def = this.requireIndex(index);
    const hitsPerPage = Math.min(
      request.limit ?? this.defaultPageSize,
      this.maxPageSize,
    );
    const filter = this.buildFilter(def, request.filters, principal);
    const sort = this.buildSort(def, request.sort);

    try {
      const result = await this.engine.search<T>(index, {
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
        this.logger.warn(`Search failed on "${index}": ${error.message}`);
        throw new ServiceUnavailableException(
          'Search is temporarily unavailable',
        );
      }
      throw error;
    }
  }

  async enqueueIndex(
    index: IndexName,
    docs: Array<Record<string, unknown>>,
  ): Promise<void> {
    this.requireIndex(index);
    await this.queue.add(
      SEARCH_INDEX_DOCS_JOB,
      { index, docs },
      this.jobOpts(),
    );
  }

  async enqueueDelete(index: IndexName, ids: string[]): Promise<void> {
    this.requireIndex(index);
    await this.queue.add(
      SEARCH_DELETE_DOCS_JOB,
      { index, ids },
      this.jobOpts(),
    );
  }

  async reindex(index: IndexName): Promise<void> {
    this.requireIndex(index);
    await this.queue.add(SEARCH_REINDEX_JOB, { index }, this.jobOpts());
  }

  private jobOpts() {
    return {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
      removeOnFail: 100,
    } as const;
  }

  private requireIndex(index: string): RegisteredIndex {
    const def = this.registry.get(index);
    if (!def) throw new NotFoundException(`Unknown search index "${index}"`);
    return def;
  }

  private buildFilter(
    def: RegisteredIndex,
    filters: SearchRequest['filters'],
    principal: Principal,
  ): string[] {
    const clauses: string[] = [];
    if (def.ownerScope && principal.id !== null) {
      const attr = def.ownerScope.attribute;
      const own = `${attr} = ${quote(principal.id)}`;
      clauses.push(
        def.ownerScope.allowPublic ? `(${own} OR ${attr} IS NULL)` : own,
      );
    }
    for (const [field, value] of Object.entries(filters ?? {})) {
      if (def.ownerScope && field === def.ownerScope.attribute) {
        throw new BadRequestException(`Filtering on "${field}" is not allowed`);
      }
      if (!def.allowedFilterFields.includes(field)) {
        throw new BadRequestException(`Unknown filter field "${field}"`);
      }
      clauses.push(toFilterClause(field, value));
    }
    return clauses;
  }

  private buildSort(def: RegisteredIndex, sort?: string[]): string[] {
    if (!sort) return [];
    return sort.map((entry) => {
      const [field, dir] = entry.split(':');
      if (
        !def.allowedSortFields.includes(field) ||
        (dir !== 'asc' && dir !== 'desc')
      ) {
        throw new BadRequestException(`Invalid sort "${entry}"`);
      }
      return `${field}:${dir}`;
    });
  }

  private pickFacets(
    def: RegisteredIndex,
    facets?: string[],
  ): string[] | undefined {
    if (!facets) return undefined;
    const invalid = facets.filter((f) => !def.filterableAttributes.includes(f));
    if (invalid.length) {
      throw new BadRequestException(`Unknown facet(s): ${invalid.join(', ')}`);
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
