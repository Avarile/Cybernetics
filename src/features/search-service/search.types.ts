export type {
  FieldSpec,
  FieldType,
} from '../../infrastructure/database/schema/search.schema';

/** Record sync state, mirroring the `search_index_state` DB enum. */
export type IndexState = 'PENDING' | 'INDEXED' | 'FAILED';

/** Registered collection name. Validated against the registry at runtime. */
export type CollectionName = string;

/** A structured filter value from a caller (never raw Meili syntax). */
export type SearchFilterValue =
  | string
  | number
  | boolean
  | Array<string | number>;

/** External/internal search request (post-validation). */
export interface SearchRequest {
  q: string;
  page: number;
  limit?: number;
  filters?: Record<string, SearchFilterValue>;
  sort?: string[]; // "field:asc" | "field:desc"
  facets?: string[];
  highlight?: string[];
}

/** Normalised search response. */
export interface SearchResults<T> {
  hits: T[];
  page: number;
  limit: number;
  totalHits: number;
  totalPages: number;
  facetDistribution?: Record<string, Record<string, number>>;
  processingTimeMs: number;
}
