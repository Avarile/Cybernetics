// Note: the installed meilisearch@0.59.0 package exports its client class as
// `Meilisearch` (not `MeiliSearch` as in older versions/docs) — see
// node_modules/meilisearch/README.md and dist/meilisearch.d.ts.
import type { Meilisearch } from 'meilisearch';

/** DI token for the raw MeiliSearch client (internal + health check). */
export const MEILI_CLIENT = Symbol('MEILI_CLIENT');

/** DI token for the index-agnostic search abstraction (swappable backend). */
export const SEARCH_ENGINE = Symbol('SEARCH_ENGINE');

/** Convenience alias for the MeiliSearch client type. */
export type MeiliClient = Meilisearch;
