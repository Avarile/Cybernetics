import { Injectable } from '@nestjs/common';
import type {
  CollectionRow,
  FieldSpec,
} from '../../infrastructure/database/schema/search.schema';
import type { IndexDefinition } from '../../infrastructure/search-engine/search-engine.interface';
import { CollectionRepository } from './collection.repository';
import { fieldSpecToIndexDefinition } from './document-validator';

/** A collection compiled for runtime use: config + derived Meili definition. */
export interface CompiledCollection {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  definition: IndexDefinition;
}

/**
 * In-memory cache of compiled collections over the `collections` table. A
 * cache miss falls back to the repository so a collection created on another
 * instance is still resolvable without a restart. Mutations call `invalidate`.
 */
@Injectable()
export class IndexRegistry {
  private readonly cache = new Map<string, CompiledCollection>();

  constructor(private readonly collections: CollectionRepository) {}

  /** Resolve a collection by name (cache-first, repo fallback). */
  async resolve(name: string): Promise<CompiledCollection | null> {
    const cached = this.cache.get(name);
    if (cached) return cached;
    const found = await this.collections.findByName(name);
    if (!found) return null;
    const compiled = compile(found);
    this.cache.set(name, compiled);
    return compiled;
  }

  /** Drop a cached entry so the next resolve recompiles from the DB. */
  invalidate(name: string): void {
    this.cache.delete(name);
  }

  /** Load and cache every active collection (boot warm-up). */
  async warm(): Promise<CompiledCollection[]> {
    const rows = await this.collections.listActive();
    this.cache.clear();
    const all: CompiledCollection[] = [];
    for (const row of rows) {
      const compiled = compile(row);
      this.cache.set(row.name, compiled);
      all.push(compiled);
    }
    return all;
  }
}

function compile(row: CollectionRow): CompiledCollection {
  return {
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    fields: row.fields,
    definition: fieldSpecToIndexDefinition(row.name, row.fields),
  };
}
