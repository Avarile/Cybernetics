import { registerAs } from '@nestjs/config';
import { validateEnv } from '../env.validation';

/**
 * Namespaced search-engine config (MeiliSearch connection + search policy).
 * Consumed by the search-engine infrastructure module, the Meili health
 * indicator, and the search-service feature.
 */
export const searchConfig = registerAs('search', () => {
  const env = validateEnv(process.env);
  const scheme = env.MEILISEARCH_USE_SSL ? 'https' : 'http';
  return {
    host: `${scheme}://${env.MEILISEARCH_HOST}:${env.MEILISEARCH_PORT}`,
    apiKey: env.MEILISEARCH_MASTER_KEY,
    indexPrefix: env.MEILISEARCH_INDEX_PREFIX,
    taskTimeoutMs: env.MEILISEARCH_TASK_TIMEOUT_MS,
    searchTimeoutMs: env.MEILISEARCH_SEARCH_TIMEOUT_MS,
    defaultPageSize: env.SEARCH_DEFAULT_PAGE_SIZE,
    maxPageSize: env.SEARCH_MAX_PAGE_SIZE,
  };
});

export type SearchConfig = ReturnType<typeof searchConfig>;
