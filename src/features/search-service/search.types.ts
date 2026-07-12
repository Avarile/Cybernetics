/** Registered index name. Validated against the registry at runtime. */
export type IndexName = string;

/** A structured filter value from an external caller (never raw Meili syntax). */
export type SearchFilterValue =
  string | number | boolean | Array<string | number>;

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

/** Normalised, owner-scoped search response. */
export interface SearchResults<T> {
  hits: T[];
  page: number;
  limit: number;
  totalHits: number;
  totalPages: number;
  facetDistribution?: Record<string, Record<string, number>>;
  processingTimeMs: number;
}
