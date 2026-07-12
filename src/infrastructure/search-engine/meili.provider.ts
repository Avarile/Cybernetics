import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Note: the installed meilisearch@0.59.0 package exports its client class as
// `Meilisearch` (not `MeiliSearch` as in older versions/docs) — see
// node_modules/meilisearch/README.md and dist/meilisearch.d.ts.
import { Meilisearch } from 'meilisearch';
import type { SearchConfig } from '../../config/configurations/search.config';
import { MEILI_CLIENT } from './meili.constants';

/**
 * Builds the MeiliSearch client from validated config. Like the MinIO client,
 * it is a stateless HTTP client — no shutdown lifecycle needed.
 */
export const meiliClientProvider: Provider = {
  provide: MEILI_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Meilisearch => {
    const cfg = config.getOrThrow<SearchConfig>('search');
    return new Meilisearch({
      host: cfg.host,
      apiKey: cfg.apiKey,
      timeout: cfg.searchTimeoutMs,
    });
  },
};
