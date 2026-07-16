/** Declarative index definition applied by `ensureIndex`. */
export interface IndexDefinition {
  name: string;
  primaryKey: string;
  searchableAttributes: string[];
  filterableAttributes: string[];
  sortableAttributes: string[];
  rankingRules?: string[];
  maxTotalHits?: number; // pagination.maxTotalHits (default 1000)
}

/** A low-level query the engine understands. Filters are composed by callers. */
export interface EngineQuery {
  q: string;
  filter?: string | string[];
  sort?: string[];
  facets?: string[];
  page?: number;
  hitsPerPage?: number;
  attributesToHighlight?: string[];
  attributesToRetrieve?: string[];
}

/** Normalised search result independent of the backend response shape. */
export interface EngineResult<T> {
  hits: T[];
  totalHits: number;
  page: number;
  hitsPerPage: number;
  totalPages: number;
  facetDistribution?: Record<string, Record<string, number>>;
  processingTimeMs: number;
}

/** Reference to an async engine task (Meili applies mutations asynchronously). */
export interface TaskRef {
  taskUid: number;
}

/** Raised when the engine errors or an async task fails. */
export class SearchEngineError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SearchEngineError';
  }
}

/** Index-agnostic search capability. Knows nothing about any domain. */
export interface SearchEngine {
  ensureIndex(def: IndexDefinition): Promise<void>;
  addOrReplace(
    index: string,
    docs: Array<Record<string, unknown>>,
  ): Promise<TaskRef>;
  update(index: string, docs: Array<Record<string, unknown>>): Promise<TaskRef>;
  deleteDocuments(index: string, ids: string[]): Promise<TaskRef>;
  deleteByFilter(index: string, filter: string | string[]): Promise<TaskRef>;
  clearIndex(index: string): Promise<TaskRef>;
  deleteIndex(index: string): Promise<TaskRef>;
  search<T = Record<string, unknown>>(
    index: string,
    query: EngineQuery,
  ): Promise<EngineResult<T>>;
  waitForTask(taskUid: number): Promise<void>;
  health(): Promise<boolean>;
}
