import { Inject, Injectable } from '@nestjs/common';
import type { IndexDefinition } from '../../infrastructure/search-engine/search-engine.interface';
import { SEARCH_INDEX_DEFINITIONS } from './search.constants';

/** How an index is tenant-scoped, if at all. */
export interface OwnerScope {
  attribute: string;
  allowPublic?: boolean; // also match rows whose owner attribute IS NULL
}

/**
 * A fully-described index: Meili settings + feature-level access rules and an
 * (optional) rebuild source used by reconciliation.
 */
export interface RegisteredIndex extends IndexDefinition {
  ownerScope?: OwnerScope;
  allowedFilterFields: string[];
  allowedSortFields: string[];
  source?: () => Promise<Array<Record<string, unknown>>>;
}

/**
 * The app's registered indexes. Consumers (e.g. the files feature, later)
 * append their definition here. Empty for now — the engine + service are
 * generic and gain indexes without any change to this module.
 */
export const APP_SEARCH_INDEXES: RegisteredIndex[] = [];

/** In-memory lookup over the registered index definitions. */
@Injectable()
export class IndexRegistry {
  private readonly byName = new Map<string, RegisteredIndex>();

  constructor(@Inject(SEARCH_INDEX_DEFINITIONS) defs: RegisteredIndex[]) {
    for (const def of defs) {
      if (this.byName.has(def.name)) {
        throw new Error(`Duplicate search index definition: ${def.name}`);
      }
      this.byName.set(def.name, def);
    }
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  get(name: string): RegisteredIndex | undefined {
    return this.byName.get(name);
  }

  all(): RegisteredIndex[] {
    return [...this.byName.values()];
  }
}
