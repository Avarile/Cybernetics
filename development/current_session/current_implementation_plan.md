# Search Management Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `src/features/search-service` into a generic data processor: admins persist arbitrary structured records to Postgres (source of truth), records are asynchronously indexed into MeiliSearch via BullMQ, and any authenticated principal queries MeiliSearch only.

**Architecture:** Dynamic collections (a `collections` table) each carry a **field-spec** that drives both write-time validation and the Meili attribute config. Records live in one generic `search_records` JSONB table. Clean layers: controllers (HTTP + authz) → services (`CollectionService`, `SearchRecordService`) → repositories (Drizzle). An `IndexRegistry` caches compiled collections. A BullMQ processor applies all index mutations off the request path; a reconciliation sweep repairs drift.

**Tech Stack:** NestJS 11, Drizzle ORM 0.45 over `pg`, MeiliSearch (client pinned 0.45.x, CJS), BullMQ 5, Zod, Jest 30 + supertest.

## Global Constraints

- Keep every file under **500 lines**; validate input at system boundaries.
- **Do NOT** upgrade `meilisearch` past 0.45.x (0.49+ is ESM-only and breaks the CJS build).
- E2E specs boot a **focused module subset** (`ConfigModule + QueueModule + SearchEngineModule + SearchServiceModule + AuthModule + UsersModule + DatabaseModule`), never `AppModule` (Mastra's ESM dep breaks Jest).
- Datastores come from `.env`: Postgres `:30898`, Redis `:30490` (already configured).
- Persistence uses **Drizzle + `pg`**: `baseColumns` (uuid id + timestamps + soft-delete), repositories `extends BaseRepository`, `@Inject(DRIZZLE)`.
- HTTP validation uses **Zod DTOs + `ZodValidationPipe`**; authz uses **`@Roles(...)` + global `RolesGuard`** (roles: `guest | user | admin | agent`); the current principal comes from `@CurrentUser()`.
- The `SearchEngine` (infra) applies the Meili index **prefix internally**; always pass the bare collection name.
- Do **NOT** add a `Co-Authored-By` trailer to commits (project `.claude/settings.json` has no `attribution.commit`).
- Reference the design at `development/current_session/current_design.md`.

**Unit test command:** `pnpm test -- <path>` · **E2E command:** `pnpm test:e2e -- search.e2e` · **Typecheck:** `pnpm typecheck`

---

### Task 1: Database schema + migration

**Files:**
- Create: `src/infrastructure/database/schema/search.schema.ts`
- Modify: `src/infrastructure/database/schema/index.ts` (add barrel export)
- Test: `src/infrastructure/database/schema/search.schema.spec.ts`
- Generated: `src/infrastructure/database/migrations/000X_*.sql` (via drizzle-kit)

**Interfaces:**
- Produces: table objects `collections`, `searchRecords`; enum `searchIndexState`; types `FieldType`, `FieldSpec`, `CollectionRow`, `NewCollectionRow`, `SearchRecordRow`, `NewSearchRecordRow`.

- [ ] **Step 1: Write the failing schema spec**

Create `src/infrastructure/database/schema/search.schema.spec.ts`:

```ts
import {
  collections,
  searchIndexState,
  searchRecords,
} from './search.schema';

describe('search schema', () => {
  it('defines the search_index_state enum', () => {
    expect(searchIndexState.enumValues).toEqual([
      'PENDING',
      'INDEXED',
      'FAILED',
    ]);
  });

  it('exposes the search tables', () => {
    expect(collections).toBeDefined();
    expect(searchRecords).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test -- src/infrastructure/database/schema/search.schema.spec.ts`
Expected: FAIL — `Cannot find module './search.schema'`.

- [ ] **Step 3: Create the schema**

Create `src/infrastructure/database/schema/search.schema.ts`:

```ts
import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { baseColumns } from './common';

/** Primitive field types a collection document may declare. */
export type FieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'string[]'
  | 'number[]';

/**
 * One field in a collection's schema. The per-field flags drive BOTH write-time
 * validation AND the Meili attribute config, so the two can never drift.
 */
export interface FieldSpec {
  name: string;
  type: FieldType;
  required?: boolean;
  searchable?: boolean;
  filterable?: boolean;
  sortable?: boolean;
  enum?: Array<string | number>;
}

/** Sync state of a record vs. its Meili document (a lightweight outbox marker). */
export const searchIndexState = pgEnum('search_index_state', [
  'PENDING',
  'INDEXED',
  'FAILED',
]);

/**
 * A dynamic, admin-managed collection (logical Meili index). `name` is the
 * immutable identity used in URLs and as the Meili index name (the engine adds
 * the configured prefix). `fields` is the field-spec that governs validation
 * and Meili attributes.
 */
export const collections = pgTable(
  'collections',
  {
    ...baseColumns,
    name: varchar('name', { length: 100 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: varchar('description', { length: 500 }),
    fields: jsonb('fields').$type<FieldSpec[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex('collections_name_idx')
      .on(t.name)
      .where(sql`${t.isDeleted} = false`),
  ],
);

/**
 * A persisted record. Postgres is the source of truth; Meili is a rebuildable
 * read model. `id` is the Meili document primary key. `externalId` is the
 * caller's optional business key enabling idempotent upsert. `checksum` detects
 * unchanged re-writes. `indexState` is the outbox marker reconciliation repairs.
 */
export const searchRecords = pgTable(
  'search_records',
  {
    ...baseColumns,
    collection: varchar('collection', { length: 100 }).notNull(),
    externalId: varchar('external_id', { length: 255 }),
    document: jsonb('document')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    indexState: searchIndexState('index_state').notNull().default('PENDING'),
    indexError: varchar('index_error', { length: 1000 }),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('search_records_collection_external_idx')
      .on(t.collection, t.externalId)
      .where(sql`${t.externalId} IS NOT NULL AND ${t.isDeleted} = false`),
    index('search_records_collection_deleted_idx').on(t.collection, t.isDeleted),
    index('search_records_collection_state_idx').on(t.collection, t.indexState),
  ],
);

export type CollectionRow = typeof collections.$inferSelect;
export type NewCollectionRow = typeof collections.$inferInsert;
export type SearchRecordRow = typeof searchRecords.$inferSelect;
export type NewSearchRecordRow = typeof searchRecords.$inferInsert;
```

- [ ] **Step 4: Add the barrel export**

In `src/infrastructure/database/schema/index.ts`, add after the existing exports:

```ts
export * from './search.schema';
```

- [ ] **Step 5: Run the spec + typecheck to verify they pass**

Run: `pnpm test -- src/infrastructure/database/schema/search.schema.spec.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `src/infrastructure/database/migrations/000X_*.sql` is created containing `CREATE TABLE "collections"` and `CREATE TABLE "search_records"` plus the `search_index_state` enum. Confirm with `git status`.

- [ ] **Step 7: Commit**

```bash
git add src/infrastructure/database/schema/search.schema.ts \
  src/infrastructure/database/schema/index.ts \
  src/infrastructure/database/schema/search.schema.spec.ts \
  src/infrastructure/database/migrations
git commit -m "feat(search): add collections + search_records schema and migration"
```

---

### Task 2: Field-spec types, constants & validation core (pure)

**Files:**
- Modify: `src/features/search-service/search.types.ts`
- Modify: `src/features/search-service/search.constants.ts`
- Create: `src/features/search-service/document-validator.ts`
- Create: `src/features/search-service/search.util.ts`
- Test: `src/features/search-service/document-validator.spec.ts`
- Test: `src/features/search-service/search.util.spec.ts`

**Interfaces:**
- Consumes: `FieldSpec`, `FieldType`, `SearchRecordRow` (Task 1); `IndexDefinition` (`src/infrastructure/search-engine/search-engine.interface.ts`).
- Produces:
  - `validateFieldSpec(fields: FieldSpec[]): string[]`
  - `validateDocument(fields: FieldSpec[], doc: Record<string, unknown>): string[]`
  - `fieldSpecToIndexDefinition(name: string, fields: FieldSpec[]): IndexDefinition`
  - `RESERVED_FIELD_NAMES: readonly string[]`
  - `computeChecksum(externalId: string | null, document: Record<string, unknown>): string`
  - `toMeiliDocument(row: SearchRecordRow): Record<string, unknown>`
  - `INDEXING_JOB_OPTS`
  - constants `INDEX_RECORD_JOB`, `DELETE_RECORD_JOB`, `REINDEX_COLLECTION_JOB`, `RECONCILE_JOB`, `RECONCILE_STALE_MS`; type `IndexState`, `SearchRequest`, `SearchResults`, `SearchFilterValue`.

- [ ] **Step 1: Rewrite the constants**

Replace the entire contents of `src/features/search-service/search.constants.ts`:

```ts
/** BullMQ queue that applies index mutations off the request path. */
export const SEARCH_INDEXING_QUEUE = 'search-indexing';

/** Job: sync a single record (by id) to Meili — add/replace, or delete if the row is soft-deleted. */
export const INDEX_RECORD_JOB = 'index-record';

/** Job: delete a record's document from a collection's index. */
export const DELETE_RECORD_JOB = 'delete-record';

/** Job: clear a collection's index and reload every live record from Postgres. */
export const REINDEX_COLLECTION_JOB = 'reindex-collection';

/** Job: sweep for records that never converged and re-enqueue them. */
export const RECONCILE_JOB = 'reconcile';

/** A record must be un-synced for at least this long before reconciliation retries it. */
export const RECONCILE_STALE_MS = 300_000; // 5 minutes
```

- [ ] **Step 2: Extend the shared types**

Replace the entire contents of `src/features/search-service/search.types.ts`:

```ts
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
```

- [ ] **Step 3: Write the failing validator spec**

Create `src/features/search-service/document-validator.spec.ts`:

```ts
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import {
  fieldSpecToIndexDefinition,
  validateDocument,
  validateFieldSpec,
} from './document-validator';

const fields: FieldSpec[] = [
  { name: 'title', type: 'string', required: true, searchable: true, sortable: true },
  { name: 'body', type: 'string', searchable: true },
  { name: 'tags', type: 'string[]', filterable: true },
  { name: 'price', type: 'number', filterable: true, sortable: true },
  { name: 'status', type: 'string', filterable: true, enum: ['draft', 'live'] },
];

describe('validateFieldSpec', () => {
  it('accepts a valid spec', () => {
    expect(validateFieldSpec(fields)).toEqual([]);
  });

  it('rejects an empty spec', () => {
    expect(validateFieldSpec([]).length).toBeGreaterThan(0);
  });

  it('rejects a reserved field name', () => {
    const errs = validateFieldSpec([{ name: 'id', type: 'string', searchable: true }]);
    expect(errs.some((e) => e.includes('reserved'))).toBe(true);
  });

  it('rejects a duplicate field name', () => {
    const errs = validateFieldSpec([
      { name: 'a', type: 'string', searchable: true },
      { name: 'a', type: 'number' },
    ]);
    expect(errs.some((e) => e.includes('Duplicate'))).toBe(true);
  });

  it('rejects searchable on a non-string field', () => {
    const errs = validateFieldSpec([{ name: 'n', type: 'number', searchable: true }]);
    expect(errs.some((e) => e.includes('searchable'))).toBe(true);
  });

  it('rejects sortable on an array field', () => {
    const errs = validateFieldSpec([
      { name: 't', type: 'string', searchable: true },
      { name: 'x', type: 'string[]', sortable: true },
    ]);
    expect(errs.some((e) => e.includes('sortable'))).toBe(true);
  });

  it('requires at least one searchable field', () => {
    const errs = validateFieldSpec([{ name: 'n', type: 'number', filterable: true }]);
    expect(errs.some((e) => e.includes('searchable'))).toBe(true);
  });
});

describe('validateDocument', () => {
  it('accepts a valid document', () => {
    expect(
      validateDocument(fields, { title: 'Hi', tags: ['a'], price: 9, status: 'live' }),
    ).toEqual([]);
  });

  it('flags a missing required field', () => {
    expect(validateDocument(fields, { body: 'x' }).some((e) => e.includes('title'))).toBe(true);
  });

  it('flags an unknown field', () => {
    const errs = validateDocument(fields, { title: 'x', nope: 1 });
    expect(errs.some((e) => e.includes('Unknown field "nope"'))).toBe(true);
  });

  it('flags a type mismatch', () => {
    const errs = validateDocument(fields, { title: 123 });
    expect(errs.some((e) => e.includes('title'))).toBe(true);
  });

  it('flags an out-of-enum value', () => {
    const errs = validateDocument(fields, { title: 'x', status: 'archived' });
    expect(errs.some((e) => e.includes('status'))).toBe(true);
  });

  it('flags a bad element in a string[] field', () => {
    const errs = validateDocument(fields, { title: 'x', tags: ['ok', 5] });
    expect(errs.some((e) => e.includes('tags'))).toBe(true);
  });
});

describe('fieldSpecToIndexDefinition', () => {
  it('derives Meili attributes from field flags + system fields', () => {
    const def = fieldSpecToIndexDefinition('articles', fields);
    expect(def).toEqual({
      name: 'articles',
      primaryKey: 'id',
      searchableAttributes: ['title', 'body'],
      filterableAttributes: ['tags', 'price', 'status', 'createdAt', 'updatedAt', 'externalId'],
      sortableAttributes: ['title', 'price', 'createdAt', 'updatedAt'],
    });
  });
});
```

- [ ] **Step 4: Run the spec to verify it fails**

Run: `pnpm test -- src/features/search-service/document-validator.spec.ts`
Expected: FAIL — `Cannot find module './document-validator'`.

- [ ] **Step 5: Implement the validator**

Create `src/features/search-service/document-validator.ts`:

```ts
import type {
  FieldSpec,
  FieldType,
} from '../../infrastructure/database/schema/search.schema';
import type { IndexDefinition } from '../../infrastructure/search-engine/search-engine.interface';

/** System field names on the Meili doc; a field-spec may not reuse them. */
export const RESERVED_FIELD_NAMES: readonly string[] = [
  'id',
  'externalId',
  'collection',
  'createdAt',
  'updatedAt',
];

const FIELD_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const SCALAR_TYPES: FieldType[] = ['string', 'number', 'boolean', 'date'];

/** Validate the field-spec itself. Returns human-readable errors (empty = valid). */
export function validateFieldSpec(fields: FieldSpec[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(fields) || fields.length === 0) {
    return ['A collection must declare at least one field'];
  }
  const seen = new Set<string>();
  for (const f of fields) {
    if (!FIELD_NAME_RE.test(f.name)) {
      errors.push(`Invalid field name "${f.name}"`);
    }
    if (RESERVED_FIELD_NAMES.includes(f.name)) {
      errors.push(`"${f.name}" is a reserved field name`);
    }
    if (seen.has(f.name)) errors.push(`Duplicate field "${f.name}"`);
    seen.add(f.name);
    if (f.searchable && f.type !== 'string' && f.type !== 'string[]') {
      errors.push(`Field "${f.name}" cannot be searchable (type ${f.type})`);
    }
    if (f.sortable && !SCALAR_TYPES.includes(f.type)) {
      errors.push(`Field "${f.name}" cannot be sortable (type ${f.type})`);
    }
  }
  if (!fields.some((f) => f.searchable)) {
    errors.push('At least one field must be searchable');
  }
  return errors;
}

/** Validate a document payload against a field-spec. Returns errors (empty = valid). */
export function validateDocument(
  fields: FieldSpec[],
  doc: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const allowed = new Set(fields.map((f) => f.name));
  for (const key of Object.keys(doc)) {
    if (!allowed.has(key)) errors.push(`Unknown field "${key}"`);
  }
  for (const f of fields) {
    const value = doc[f.name];
    if (value === undefined || value === null) {
      if (f.required) errors.push(`Missing required field "${f.name}"`);
      continue;
    }
    if (!matchesType(f.type, value)) {
      errors.push(`Field "${f.name}" must be of type ${f.type}`);
      continue;
    }
    if (f.enum && !inEnum(f.enum, value)) {
      errors.push(`Field "${f.name}" must be one of: ${f.enum.join(', ')}`);
    }
  }
  return errors;
}

/** Derive the Meili attribute config from a field-spec. One source of truth. */
export function fieldSpecToIndexDefinition(
  name: string,
  fields: FieldSpec[],
): IndexDefinition {
  return {
    name,
    primaryKey: 'id',
    searchableAttributes: fields.filter((f) => f.searchable).map((f) => f.name),
    filterableAttributes: [
      ...fields.filter((f) => f.filterable).map((f) => f.name),
      'createdAt',
      'updatedAt',
      'externalId',
    ],
    sortableAttributes: [
      ...fields.filter((f) => f.sortable).map((f) => f.name),
      'createdAt',
      'updatedAt',
    ],
  };
}

function matchesType(type: FieldType, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'string[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'number[]':
      return (
        Array.isArray(value) &&
        value.every((v) => typeof v === 'number' && Number.isFinite(v))
      );
  }
}

function inEnum(allowed: Array<string | number>, value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every((v) => allowed.includes(v as string | number));
  }
  return allowed.includes(value as string | number);
}
```

- [ ] **Step 6: Run the spec to verify it passes**

Run: `pnpm test -- src/features/search-service/document-validator.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 7: Write the failing util spec**

Create `src/features/search-service/search.util.spec.ts`:

```ts
import type { SearchRecordRow } from '../../infrastructure/database/schema/search.schema';
import { computeChecksum, toMeiliDocument } from './search.util';

describe('computeChecksum', () => {
  it('is stable regardless of document key order', () => {
    const a = computeChecksum('x', { a: 1, b: 2 });
    const b = computeChecksum('x', { b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('changes when the document changes', () => {
    expect(computeChecksum('x', { a: 1 })).not.toBe(computeChecksum('x', { a: 2 }));
  });

  it('changes when the externalId changes', () => {
    expect(computeChecksum('x', { a: 1 })).not.toBe(computeChecksum('y', { a: 1 }));
  });
});

describe('toMeiliDocument', () => {
  const row = {
    id: 'rec-1',
    collection: 'articles',
    externalId: 'ext-1',
    document: { title: 'Hi', tags: ['a'] },
    checksum: 'c',
    indexState: 'PENDING',
    indexError: null,
    indexedAt: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  } as SearchRecordRow;

  it('spreads the document with system fields and epoch timestamps', () => {
    expect(toMeiliDocument(row)).toEqual({
      id: 'rec-1',
      externalId: 'ext-1',
      title: 'Hi',
      tags: ['a'],
      createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
      updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
    });
  });

  it('omits externalId when absent', () => {
    const doc = toMeiliDocument({ ...row, externalId: null });
    expect('externalId' in doc).toBe(false);
  });
});
```

- [ ] **Step 8: Run the spec to verify it fails**

Run: `pnpm test -- src/features/search-service/search.util.spec.ts`
Expected: FAIL — `Cannot find module './search.util'`.

- [ ] **Step 9: Implement the util**

Create `src/features/search-service/search.util.ts`:

```ts
import { createHash } from 'node:crypto';
import type { SearchRecordRow } from '../../infrastructure/database/schema/search.schema';

/** Shared BullMQ options for indexing jobs: bounded retries, self-cleaning. */
export const INDEXING_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
  removeOnComplete: true,
  removeOnFail: 100,
} as const;

/** sha256 over a canonical (key-sorted) serialization — order-independent. */
export function computeChecksum(
  externalId: string | null,
  document: Record<string, unknown>,
): string {
  const canonical = stableStringify({ externalId: externalId ?? null, document });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Build the Meili document from a record row (system fields + payload). */
export function toMeiliDocument(row: SearchRecordRow): Record<string, unknown> {
  return {
    id: row.id,
    ...(row.externalId ? { externalId: row.externalId } : {}),
    ...row.document,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** Deterministic JSON with recursively sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}
```

- [ ] **Step 10: Run both specs + confirm this task compiles**

Run: `pnpm test -- src/features/search-service/document-validator.spec.ts src/features/search-service/search.util.spec.ts`
Expected: PASS.

> Note: a full `pnpm typecheck` will still report errors in the not-yet-updated `search.service.ts`, `index-registry.ts`, `search.controller.ts`, and the processor/scheduler (they still reference the old `RegisteredIndex`/`SEARCH_INDEX_DEFINITIONS`). That is expected — those files are rewritten in Tasks 4–9. A clean full typecheck is asserted at the end of Task 9.

- [ ] **Step 11: Commit**

```bash
git add src/features/search-service/search.constants.ts \
  src/features/search-service/search.types.ts \
  src/features/search-service/document-validator.ts \
  src/features/search-service/document-validator.spec.ts \
  src/features/search-service/search.util.ts \
  src/features/search-service/search.util.spec.ts
git commit -m "feat(search): field-spec validation, checksum + Meili doc helpers, job constants"
```

---

### Task 3: Repositories

**Files:**
- Create: `src/features/search-service/collection.repository.ts`
- Create: `src/features/search-service/search-record.repository.ts`

**Interfaces:**
- Consumes: `collections`, `searchRecords`, row types (Task 1); `DRIZZLE`, `DrizzleDB`, `BaseRepository`.
- Produces:
  - `CollectionRepository`: `create` (inherited), `findByName(name)`, `listActive()`, `updateByName(name, patch)`, `softDeleteByName(name)`.
  - `SearchRecordRepository`: `create` (inherited), `findById(id)` (inherited, includes soft-deleted), `findLiveById(id)`, `findLiveByExternalId(collection, externalId)`, `update(id, patch)`, `markIndexState(id, state, patch?)`, `softDelete(id)`, `pageLiveByCollection(collection, limit, afterId)`, `markCollectionIndexed(collection)`, `softDeleteByCollection(collection)`, `findUnsynced(olderThan, limit)`.

> These repositories are thin Drizzle wrappers with no branching logic, so they are verified by `pnpm typecheck` here and exercised end-to-end against real Postgres in Task 10. (This matches the existing `file.repository.ts` / `integration-credential.repository.ts` convention — no mocked-Drizzle unit specs.)

- [ ] **Step 1: Implement the collection repository**

Create `src/features/search-service/collection.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  collections,
  type CollectionRow,
  type NewCollectionRow,
} from '../../infrastructure/database/schema/search.schema';

/** Repository for the `collections` table. */
@Injectable()
export class CollectionRepository extends BaseRepository<typeof collections> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, collections);
  }

  /** A live collection by its unique name. */
  async findByName(name: string): Promise<CollectionRow | null> {
    const rows = await this.db
      .select()
      .from(collections)
      .where(and(eq(collections.name, name), eq(collections.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** All live collections, newest first. */
  async listActive(): Promise<CollectionRow[]> {
    return this.db
      .select()
      .from(collections)
      .where(eq(collections.isDeleted, false))
      .orderBy(desc(collections.createdAt));
  }

  async updateByName(
    name: string,
    patch: Partial<NewCollectionRow>,
  ): Promise<CollectionRow | null> {
    const rows = await this.db
      .update(collections)
      .set(patch)
      .where(and(eq(collections.name, name), eq(collections.isDeleted, false)))
      .returning();
    return rows[0] ?? null;
  }

  async softDeleteByName(name: string): Promise<void> {
    await this.db
      .update(collections)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(collections.name, name));
  }
}
```

- [ ] **Step 2: Implement the search-record repository**

Create `src/features/search-service/search-record.repository.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  searchRecords,
  type NewSearchRecordRow,
  type SearchRecordRow,
} from '../../infrastructure/database/schema/search.schema';
import type { IndexState } from './search.types';

/** Repository for the `search_records` table. */
@Injectable()
export class SearchRecordRepository extends BaseRepository<typeof searchRecords> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, searchRecords);
  }

  /** A live (non-deleted) record by id. */
  async findLiveById(id: string): Promise<SearchRecordRow | null> {
    const rows = await this.db
      .select()
      .from(searchRecords)
      .where(and(eq(searchRecords.id, id), eq(searchRecords.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** A live record by its (collection, externalId) business key. */
  async findLiveByExternalId(
    collection: string,
    externalId: string,
  ): Promise<SearchRecordRow | null> {
    const rows = await this.db
      .select()
      .from(searchRecords)
      .where(
        and(
          eq(searchRecords.collection, collection),
          eq(searchRecords.externalId, externalId),
          eq(searchRecords.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async update(
    id: string,
    patch: Partial<NewSearchRecordRow>,
  ): Promise<SearchRecordRow | null> {
    const rows = await this.db
      .update(searchRecords)
      .set(patch)
      .where(eq(searchRecords.id, id))
      .returning();
    return rows[0] ?? null;
  }

  /** Stamp sync state (and optional error / indexedAt) for one record. */
  async markIndexState(
    id: string,
    state: IndexState,
    patch: { indexError?: string | null; indexedAt?: Date | null } = {},
  ): Promise<void> {
    await this.db
      .update(searchRecords)
      .set({ indexState: state, ...patch })
      .where(eq(searchRecords.id, id));
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(searchRecords)
      .set({ isDeleted: true, deletedAt: new Date(), indexState: 'PENDING' })
      .where(eq(searchRecords.id, id));
  }

  /** Keyset page of live records for a collection, ordered by id (reload source). */
  async pageLiveByCollection(
    collection: string,
    limit: number,
    afterId: string | null,
  ): Promise<SearchRecordRow[]> {
    const conditions = [
      eq(searchRecords.collection, collection),
      eq(searchRecords.isDeleted, false),
    ];
    if (afterId) conditions.push(gt(searchRecords.id, afterId));
    return this.db
      .select()
      .from(searchRecords)
      .where(and(...conditions))
      .orderBy(asc(searchRecords.id))
      .limit(limit);
  }

  /** Mark every live record in a collection as converged (after a full reload). */
  async markCollectionIndexed(collection: string): Promise<void> {
    await this.db
      .update(searchRecords)
      .set({ indexState: 'INDEXED', indexedAt: new Date(), indexError: null })
      .where(
        and(
          eq(searchRecords.collection, collection),
          eq(searchRecords.isDeleted, false),
        ),
      );
  }

  /** Purge a collection's records (used when the collection is deleted). */
  async softDeleteByCollection(collection: string): Promise<void> {
    await this.db
      .update(searchRecords)
      .set({
        isDeleted: true,
        deletedAt: new Date(),
        indexState: 'INDEXED',
        indexedAt: new Date(),
      })
      .where(
        and(
          eq(searchRecords.collection, collection),
          eq(searchRecords.isDeleted, false),
        ),
      );
  }

  /** Records that never converged, stale enough to retry (reconciliation). */
  async findUnsynced(olderThan: Date, limit: number): Promise<SearchRecordRow[]> {
    return this.db
      .select()
      .from(searchRecords)
      .where(
        and(
          inArray(searchRecords.indexState, ['PENDING', 'FAILED']),
          lt(searchRecords.updatedAt, olderThan),
        ),
      )
      .limit(limit);
  }
}
```

- [ ] **Step 3: Typecheck the new files**

Run: `pnpm typecheck 2>&1 | grep -E "collection.repository|search-record.repository" || echo "no errors in the new repositories"`
Expected: `no errors in the new repositories` (pre-existing errors in the not-yet-rewritten files may still print; the two new repos must be clean).

- [ ] **Step 4: Commit**

```bash
git add src/features/search-service/collection.repository.ts \
  src/features/search-service/search-record.repository.ts
git commit -m "feat(search): collection + search-record repositories"
```

---

### Task 4: IndexRegistry (DB-backed compiled cache)

**Files:**
- Rewrite: `src/features/search-service/index-registry.ts`
- Rewrite: `src/features/search-service/index-registry.spec.ts`

**Interfaces:**
- Consumes: `CollectionRepository` (Task 3); `fieldSpecToIndexDefinition` (Task 2); `CollectionRow`, `FieldSpec` (Task 1); `IndexDefinition`.
- Produces:
  - `interface CompiledCollection { name: string; displayName: string; description: string | null; fields: FieldSpec[]; definition: IndexDefinition }`
  - `IndexRegistry`: `resolve(name): Promise<CompiledCollection | null>` (cache, falling back to the repo), `invalidate(name): void`, `warm(): Promise<CompiledCollection[]>`.

- [ ] **Step 1: Rewrite the failing registry spec**

Replace the entire contents of `src/features/search-service/index-registry.spec.ts`:

```ts
import type { CollectionRow } from '../../infrastructure/database/schema/search.schema';
import { IndexRegistry } from './index-registry';

function row(name: string): CollectionRow {
  return {
    id: `id-${name}`,
    name,
    displayName: name,
    description: null,
    fields: [{ name: 'title', type: 'string', searchable: true }],
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CollectionRow;
}

function makeRepo(rows: CollectionRow[]) {
  return {
    findByName: jest.fn(async (name: string) => rows.find((r) => r.name === name) ?? null),
    listActive: jest.fn(async () => rows),
  };
}

describe('IndexRegistry', () => {
  it('resolves from the repo on a cache miss and compiles a definition', async () => {
    const repo = makeRepo([row('articles')]);
    const reg = new IndexRegistry(repo as never);
    const compiled = await reg.resolve('articles');
    expect(compiled?.definition.searchableAttributes).toEqual(['title']);
    expect(repo.findByName).toHaveBeenCalledTimes(1);
  });

  it('serves a second resolve from cache without hitting the repo again', async () => {
    const repo = makeRepo([row('articles')]);
    const reg = new IndexRegistry(repo as never);
    await reg.resolve('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown collection', async () => {
    const repo = makeRepo([]);
    const reg = new IndexRegistry(repo as never);
    expect(await reg.resolve('nope')).toBeNull();
  });

  it('invalidate forces a recompile on next resolve', async () => {
    const repo = makeRepo([row('articles')]);
    const reg = new IndexRegistry(repo as never);
    await reg.resolve('articles');
    reg.invalidate('articles');
    await reg.resolve('articles');
    expect(repo.findByName).toHaveBeenCalledTimes(2);
  });

  it('warm loads and caches every active collection', async () => {
    const repo = makeRepo([row('a'), row('b')]);
    const reg = new IndexRegistry(repo as never);
    const all = await reg.warm();
    expect(all).toHaveLength(2);
    await reg.resolve('a');
    expect(repo.findByName).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test -- src/features/search-service/index-registry.spec.ts`
Expected: FAIL (the current `IndexRegistry` constructor takes an array of defs, so `new IndexRegistry(repo)` and `resolve` do not behave as asserted).

- [ ] **Step 3: Rewrite the registry**

Replace the entire contents of `src/features/search-service/index-registry.ts`:

```ts
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
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm test -- src/features/search-service/index-registry.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/search-service/index-registry.ts \
  src/features/search-service/index-registry.spec.ts
git commit -m "feat(search): DB-backed compiled IndexRegistry cache"
```

---

### Task 5: SearchEngine.deleteIndex + CollectionService

**Files:**
- Modify: `src/infrastructure/search-engine/search-engine.interface.ts` (add `deleteIndex`)
- Modify: `src/infrastructure/search-engine/search-engine.service.ts` (implement `deleteIndex`)
- Modify: `src/infrastructure/search-engine/search-engine.service.spec.ts` (add a `deleteIndex` case)
- Create: `src/features/search-service/collection.service.ts`
- Create: `src/features/search-service/collection.service.spec.ts`

**Interfaces:**
- Consumes: `SearchEngine` (+ new `deleteIndex`), `IndexRegistry`, `CollectionRepository`, `SearchRecordRepository`, `fieldSpecToIndexDefinition`, `REINDEX_COLLECTION_JOB`, `SEARCH_INDEXING_QUEUE`, `INDEXING_JOB_OPTS`.
- Produces:
  - `interface CollectionView { name; displayName; description: string | null; fields: FieldSpec[]; createdAt: Date; updatedAt: Date }`
  - `interface CreateCollectionInput { name; displayName; description?; fields: FieldSpec[] }`
  - `interface UpdateCollectionInput { displayName?; description?: string | null; fields?: FieldSpec[] }`
  - `CollectionService`: `create(input)`, `list()`, `get(name)`, `update(name, input)`, `remove(name)`, `onApplicationBootstrap()`.

- [ ] **Step 1: Add `deleteIndex` to the engine interface**

In `src/infrastructure/search-engine/search-engine.interface.ts`, inside the `SearchEngine` interface, add after `clearIndex`:

```ts
  deleteIndex(index: string): Promise<TaskRef>;
```

- [ ] **Step 2: Add a failing engine spec case**

In `src/infrastructure/search-engine/search-engine.service.spec.ts`, add a test that drives `deleteIndex`. Match the file's existing mocking style (a mocked `MeiliSearch` client). Add:

```ts
it('deleteIndex deletes the prefixed index and returns the task ref', async () => {
  const deleteIndex = jest.fn(async () => ({ taskUid: 42 }));
  const client = { deleteIndex } as unknown as import('meilisearch').MeiliSearch;
  const service = new SearchEngineService(client, {
    getOrThrow: () => ({ indexPrefix: 'test_', taskTimeoutMs: 1000 }),
  } as never);
  const ref = await service.deleteIndex('articles');
  expect(deleteIndex).toHaveBeenCalledWith('test_articles');
  expect(ref).toEqual({ taskUid: 42 });
});
```

> If the existing spec constructs the service via a Nest testing module or a shared factory, reuse that helper instead of the inline construction above — keep it consistent with the surrounding cases.

- [ ] **Step 3: Run the engine spec to verify it fails**

Run: `pnpm test -- src/infrastructure/search-engine/search-engine.service.spec.ts`
Expected: FAIL — `deleteIndex` is not a function.

- [ ] **Step 4: Implement `deleteIndex`**

In `src/infrastructure/search-engine/search-engine.service.ts`, add after `clearIndex`:

```ts
  async deleteIndex(index: string): Promise<TaskRef> {
    const task = await this.client.deleteIndex(this.uid(index));
    return { taskUid: task.taskUid };
  }
```

- [ ] **Step 5: Run the engine spec to verify it passes**

Run: `pnpm test -- src/infrastructure/search-engine/search-engine.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing CollectionService spec**

Create `src/features/search-service/collection.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IndexRegistry } from './index-registry';
import { CollectionService } from './collection.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const fields = [{ name: 'title', type: 'string', searchable: true }] as const;

function make(overrides: { existing?: boolean } = {}) {
  let stored: Record<string, unknown> | null = overrides.existing
    ? { name: 'articles' }
    : null;
  const collectionsRepo = {
    findByName: jest.fn(async () => stored),
    listActive: jest.fn(async () => (stored ? [stored] : [])),
    create: jest.fn(async (v: Record<string, unknown>) => {
      stored = { id: 'c1', createdAt: new Date(), updatedAt: new Date(), description: null, ...v };
      return stored;
    }),
    updateByName: jest.fn(async (name: string, patch: Record<string, unknown>) => {
      stored = { ...(stored ?? {}), ...patch, name };
      return stored;
    }),
    softDeleteByName: jest.fn(async () => undefined),
  };
  const recordsRepo = { softDeleteByCollection: jest.fn(async () => undefined) };
  const engine = {
    ensureIndex: jest.fn(async () => undefined),
    deleteIndex: jest.fn(async () => ({ taskUid: 1 })),
    waitForTask: jest.fn(async () => undefined),
  };
  const queue = { add: jest.fn(async () => undefined) };
  const registry = new IndexRegistry(collectionsRepo as never);
  const service = new CollectionService(
    engine as never,
    collectionsRepo as never,
    recordsRepo as never,
    registry,
    queue as never,
  );
  return { service, collectionsRepo, recordsRepo, engine, queue };
}

describe('CollectionService', () => {
  const input = { name: 'articles', displayName: 'Articles', fields: [...fields] };

  it('creates a collection and ensures its Meili index', async () => {
    const { service, engine, collectionsRepo } = make();
    const view = await service.create(input as never);
    expect(engine.ensureIndex).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'articles', searchableAttributes: ['title'] }),
    );
    expect(collectionsRepo.create).toHaveBeenCalled();
    expect(view.name).toBe('articles');
  });

  it('409s when the collection name already exists', async () => {
    const { service } = make({ existing: true });
    await expect(service.create(input as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s getting an unknown collection', async () => {
    const { service } = make();
    await expect(service.get('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove purges records, deletes the index, and invalidates the cache', async () => {
    const { service, engine, recordsRepo, collectionsRepo } = make({ existing: true });
    await service.remove('articles');
    expect(collectionsRepo.softDeleteByName).toHaveBeenCalledWith('articles');
    expect(recordsRepo.softDeleteByCollection).toHaveBeenCalledWith('articles');
    expect(engine.deleteIndex).toHaveBeenCalledWith('articles');
  });

  it('update with new fields re-ensures settings and enqueues a reload', async () => {
    const { service, engine, queue } = make({ existing: true });
    await service.update('articles', {
      fields: [{ name: 'title', type: 'string', searchable: true }, { name: 'body', type: 'string', searchable: true }],
    } as never);
    expect(engine.ensureIndex).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('reindex-collection', { collection: 'articles' }, expect.anything());
  });
});
```

- [ ] **Step 7: Run the spec to verify it fails**

Run: `pnpm test -- src/features/search-service/collection.service.spec.ts`
Expected: FAIL — `Cannot find module './collection.service'`.

- [ ] **Step 8: Implement CollectionService**

Create `src/features/search-service/collection.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../infrastructure/search-engine/search-engine.interface';
import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';
import { CollectionRepository } from './collection.repository';
import { fieldSpecToIndexDefinition } from './document-validator';
import { IndexRegistry } from './index-registry';
import { SearchRecordRepository } from './search-record.repository';
import { REINDEX_COLLECTION_JOB, SEARCH_INDEXING_QUEUE } from './search.constants';
import { INDEXING_JOB_OPTS } from './search.util';

/** A collection as returned to API callers. */
export interface CollectionView {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCollectionInput {
  name: string;
  displayName: string;
  description?: string;
  fields: FieldSpec[];
}

export interface UpdateCollectionInput {
  displayName?: string;
  description?: string | null;
  fields?: FieldSpec[];
}

/**
 * Manages the lifecycle of dynamic collections: the DB row, the Meili index +
 * settings, and the registry cache. Structural field-spec validation happens at
 * the DTO boundary; this service owns identity + Meili convergence.
 */
@Injectable()
export class CollectionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CollectionService.name);

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly collections: CollectionRepository,
    private readonly records: SearchRecordRepository,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
  ) {}

  /** Warm the registry and converge Meili settings at boot (best-effort). */
  async onApplicationBootstrap(): Promise<void> {
    let compiled;
    try {
      compiled = await this.registry.warm();
    } catch (error) {
      this.logger.warn(`Failed to warm collection registry: ${asMessage(error)}`);
      return;
    }
    for (const def of compiled) {
      try {
        await this.engine.ensureIndex(def.definition);
      } catch (error) {
        this.logger.warn(
          `Failed to ensure index "${def.name}": ${asMessage(error)}`,
        );
      }
    }
  }

  async create(input: CreateCollectionInput): Promise<CollectionView> {
    if (await this.collections.findByName(input.name)) {
      throw new ConflictException(`Collection "${input.name}" already exists`);
    }
    await this.engine.ensureIndex(
      fieldSpecToIndexDefinition(input.name, input.fields),
    );
    const row = await this.collections.create({
      name: input.name,
      displayName: input.displayName,
      description: input.description ?? null,
      fields: input.fields,
    });
    return toView(row);
  }

  async list(): Promise<CollectionView[]> {
    const rows = await this.collections.listActive();
    return rows.map(toView);
  }

  async get(name: string): Promise<CollectionView> {
    const row = await this.collections.findByName(name);
    if (!row) throw new NotFoundException(`Unknown collection "${name}"`);
    return toView(row);
  }

  async update(
    name: string,
    input: UpdateCollectionInput,
  ): Promise<CollectionView> {
    const existing = await this.collections.findByName(name);
    if (!existing) throw new NotFoundException(`Unknown collection "${name}"`);

    if (input.fields) {
      await this.engine.ensureIndex(
        fieldSpecToIndexDefinition(name, input.fields),
      );
    }
    const row = await this.collections.updateByName(name, {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.fields !== undefined ? { fields: input.fields } : {}),
    });
    if (!row) throw new NotFoundException(`Unknown collection "${name}"`);
    this.registry.invalidate(name);

    if (input.fields) {
      await this.queue.add(
        REINDEX_COLLECTION_JOB,
        { collection: name },
        INDEXING_JOB_OPTS,
      );
    }
    return toView(row);
  }

  async remove(name: string): Promise<void> {
    const existing = await this.collections.findByName(name);
    if (!existing) throw new NotFoundException(`Unknown collection "${name}"`);
    await this.collections.softDeleteByName(name);
    await this.records.softDeleteByCollection(name);
    this.registry.invalidate(name);
    try {
      await this.engine.deleteIndex(name);
    } catch (error) {
      this.logger.warn(`Failed to delete index "${name}": ${asMessage(error)}`);
    }
  }
}

function toView(row: {
  name: string;
  displayName: string;
  description: string | null;
  fields: FieldSpec[];
  createdAt: Date;
  updatedAt: Date;
}): CollectionView {
  return {
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    fields: row.fields,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 9: Run the spec to verify it passes**

Run: `pnpm test -- src/features/search-service/collection.service.spec.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/infrastructure/search-engine/search-engine.interface.ts \
  src/infrastructure/search-engine/search-engine.service.ts \
  src/infrastructure/search-engine/search-engine.service.spec.ts \
  src/features/search-service/collection.service.ts \
  src/features/search-service/collection.service.spec.ts
git commit -m "feat(search): SearchEngine.deleteIndex + CollectionService lifecycle"
```

---

### Task 6: SearchRecordService (persist / delete / reload / query)

**Files:**
- Create: `src/features/search-service/search-record.service.ts`
- Create: `src/features/search-service/search-record.service.spec.ts`
- Delete: `src/features/search-service/search.service.ts`
- Delete: `src/features/search-service/search.service.spec.ts`

**Interfaces:**
- Consumes: `SearchEngine`, `SearchRecordRepository`, `IndexRegistry` (+ `CompiledCollection`), `validateDocument`, `computeChecksum`, `SearchRequest`/`SearchResults`/`SearchFilterValue`/`IndexState`, job constants, `INDEXING_JOB_OPTS`, `SearchConfig`.
- Produces:
  - `interface RecordInput { externalId?: string; document: Record<string, unknown> }`
  - `interface PersistResult { id: string; externalId: string | null; indexState: IndexState }`
  - `SearchRecordService`: `persist(collection, records: RecordInput[])`, `remove(collection, idOrExternalId)`, `reload(collection)`, `search<T>(collection, request): Promise<SearchResults<T>>`.

- [ ] **Step 1: Write the failing service spec**

Create `src/features/search-service/search-record.service.spec.ts`:

```ts
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { SearchEngineError } from '../../infrastructure/search-engine/search-engine.interface';
import type { CompiledCollection } from './index-registry';
import { SearchRecordService } from './search-record.service';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

const compiled: CompiledCollection = {
  name: 'articles',
  displayName: 'Articles',
  description: null,
  fields: [
    { name: 'title', type: 'string', required: true, searchable: true },
    { name: 'status', type: 'string', filterable: true },
  ],
  definition: {
    name: 'articles',
    primaryKey: 'id',
    searchableAttributes: ['title'],
    filterableAttributes: ['status', 'createdAt', 'updatedAt', 'externalId'],
    sortableAttributes: ['createdAt', 'updatedAt'],
  },
};

const config = {
  getOrThrow: () => ({ defaultPageSize: 20, maxPageSize: 100 }),
} as unknown as ConfigService;

function make(repoOverrides: Record<string, any> = {}, engineOverrides: Record<string, any> = {}) {
  const engine = {
    search: jest.fn(async () => ({
      hits: [{ id: '1' }],
      totalHits: 1,
      page: 1,
      hitsPerPage: 20,
      totalPages: 1,
      processingTimeMs: 2,
    })),
    ...engineOverrides,
  };
  const records = {
    findLiveByExternalId: jest.fn(async () => null),
    findLiveById: jest.fn(async () => null),
    create: jest.fn(async (v: Record<string, unknown>) => ({ id: 'rec-1', externalId: v.externalId ?? null, ...v })),
    update: jest.fn(async (id: string, patch: Record<string, unknown>) => ({ id, externalId: 'ext', ...patch })),
    softDelete: jest.fn(async () => undefined),
    ...repoOverrides,
  };
  const queue = { add: jest.fn(async () => undefined) };
  const registry = { resolve: jest.fn(async (name: string) => (name === 'articles' ? compiled : null)) };
  const service = new SearchRecordService(engine as never, records as never, registry as never, queue as never, config);
  return { service, engine, records, queue, registry };
}

function searchArg(engine: any) {
  return engine.search.mock.calls[0]?.[1];
}

describe('SearchRecordService.persist', () => {
  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(
      service.persist('nope', [{ document: { title: 'x' } }]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400s when a document fails validation', async () => {
    const { service } = make();
    await expect(
      service.persist('articles', [{ document: { title: 123 } }]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a PENDING row and enqueues an index job', async () => {
    const { service, records, queue } = make();
    const results = await service.persist('articles', [{ document: { title: 'Hello' } }]);
    expect(records.create).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'articles', indexState: 'PENDING' }),
    );
    expect(queue.add).toHaveBeenCalledWith('index-record', { id: 'rec-1' }, expect.anything());
    expect(results[0].indexState).toBe('PENDING');
  });

  it('is a no-op when an unchanged, already-indexed record is re-sent', async () => {
    const { computeChecksum } = await import('./search.util');
    const checksum = computeChecksum('ext-1', { title: 'Hello' });
    const { service, queue } = make({
      findLiveByExternalId: jest.fn(async () => ({
        id: 'rec-1',
        externalId: 'ext-1',
        indexState: 'INDEXED',
        checksum,
      })),
      create: jest.fn(),
    });
    const results = await service.persist('articles', [{ externalId: 'ext-1', document: { title: 'Hello' } }]);
    expect(results[0].indexState).toBe('INDEXED');
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('SearchRecordService.search', () => {
  it('404s on an unknown collection', async () => {
    const { service } = make();
    await expect(service.search('nope', { q: '', page: 1 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('builds an allowlisted filter clause', async () => {
    const { service, engine } = make();
    await service.search('articles', { q: '', page: 1, filters: { status: 'live' } });
    expect(searchArg(engine).filter).toEqual(['status = "live"']);
  });

  it('rejects a non-allowlisted filter field', async () => {
    const { service } = make();
    await expect(
      service.search('articles', { q: '', page: 1, filters: { secret: 'x' } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps limit at maxPageSize', async () => {
    const { service, engine } = make();
    await service.search('articles', { q: '', page: 1, limit: 9999 });
    expect(searchArg(engine).hitsPerPage).toBe(100);
  });

  it('maps an engine failure to 503', async () => {
    const { service } = make({}, {
      search: jest.fn(async () => {
        throw new SearchEngineError('down');
      }),
    });
    await expect(service.search('articles', { q: '', page: 1 })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('SearchRecordService.remove / reload', () => {
  it('reload 404s on unknown collection then enqueues on a known one', async () => {
    const { service, queue } = make();
    await expect(service.reload('nope')).rejects.toBeInstanceOf(NotFoundException);
    await service.reload('articles');
    expect(queue.add).toHaveBeenCalledWith('reindex-collection', { collection: 'articles' }, expect.anything());
  });

  it('remove soft-deletes the row and enqueues a delete job', async () => {
    const { service, records, queue } = make({
      findLiveByExternalId: jest.fn(async () => ({ id: 'rec-9', collection: 'articles', externalId: 'ext-9' })),
    });
    await service.remove('articles', 'ext-9');
    expect(records.softDelete).toHaveBeenCalledWith('rec-9');
    expect(queue.add).toHaveBeenCalledWith('delete-record', { collection: 'articles', id: 'rec-9' }, expect.anything());
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test -- src/features/search-service/search-record.service.spec.ts`
Expected: FAIL — `Cannot find module './search-record.service'`.

- [ ] **Step 3: Implement SearchRecordService**

Create `src/features/search-service/search-record.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { SearchConfig } from '../../config/configurations/search.config';
import { SEARCH_ENGINE } from '../../infrastructure/search-engine/meili.constants';
import {
  SearchEngineError,
  type SearchEngine,
} from '../../infrastructure/search-engine/search-engine.interface';
import { validateDocument } from './document-validator';
import { IndexRegistry, type CompiledCollection } from './index-registry';
import { SearchRecordRepository } from './search-record.repository';
import {
  DELETE_RECORD_JOB,
  INDEX_RECORD_JOB,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from './search.constants';
import type {
  IndexState,
  SearchFilterValue,
  SearchRequest,
  SearchResults,
} from './search.types';
import { computeChecksum, INDEXING_JOB_OPTS } from './search.util';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordInput {
  externalId?: string;
  document: Record<string, unknown>;
}

export interface PersistResult {
  id: string;
  externalId: string | null;
  indexState: IndexState;
}

/**
 * Owns record persistence and querying. Writes go to Postgres (source of truth)
 * then enqueue an async index job; queries hit Meili only. Reads are global —
 * authorization is enforced by the controller's role guards.
 */
@Injectable()
export class SearchRecordService {
  private readonly logger = new Logger(SearchRecordService.name);
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly records: SearchRecordRepository,
    private readonly registry: IndexRegistry,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
    config: ConfigService,
  ) {
    const cfg = config.getOrThrow<SearchConfig>('search');
    this.defaultPageSize = cfg.defaultPageSize;
    this.maxPageSize = cfg.maxPageSize;
  }

  async persist(
    collection: string,
    inputs: RecordInput[],
  ): Promise<PersistResult[]> {
    const def = await this.requireCollection(collection);

    // Validate every document first — no partial writes on a bad record.
    for (const [i, input] of inputs.entries()) {
      const errors = validateDocument(def.fields, input.document);
      if (errors.length) {
        throw new BadRequestException({
          message: `Record ${i} failed validation`,
          issues: errors,
        });
      }
    }

    const results: PersistResult[] = [];
    const toIndex: string[] = [];
    for (const input of inputs) {
      const externalId = input.externalId ?? null;
      const checksum = computeChecksum(externalId, input.document);

      if (externalId) {
        const existing = await this.records.findLiveByExternalId(
          collection,
          externalId,
        );
        if (existing) {
          if (existing.checksum === checksum && existing.indexState === 'INDEXED') {
            results.push({
              id: existing.id,
              externalId: existing.externalId,
              indexState: existing.indexState,
            });
            continue;
          }
          const updated = await this.records.update(existing.id, {
            document: input.document,
            checksum,
            indexState: 'PENDING',
            indexError: null,
          });
          const row = updated ?? existing;
          toIndex.push(row.id);
          results.push({ id: row.id, externalId, indexState: 'PENDING' });
          continue;
        }
      }

      const row = await this.records.create({
        collection,
        externalId,
        document: input.document,
        checksum,
        indexState: 'PENDING',
      });
      toIndex.push(row.id);
      results.push({ id: row.id, externalId, indexState: 'PENDING' });
    }

    for (const id of toIndex) {
      await this.queue.add(INDEX_RECORD_JOB, { id }, INDEXING_JOB_OPTS);
    }
    return results;
  }

  async remove(collection: string, key: string): Promise<void> {
    await this.requireCollection(collection);
    let row = UUID_RE.test(key) ? await this.records.findLiveById(key) : null;
    if (!row) row = await this.records.findLiveByExternalId(collection, key);
    if (!row || row.collection !== collection) {
      throw new NotFoundException('Record not found');
    }
    await this.records.softDelete(row.id);
    await this.queue.add(
      DELETE_RECORD_JOB,
      { collection, id: row.id },
      INDEXING_JOB_OPTS,
    );
  }

  async reload(collection: string): Promise<void> {
    await this.requireCollection(collection);
    await this.queue.add(
      REINDEX_COLLECTION_JOB,
      { collection },
      INDEXING_JOB_OPTS,
    );
  }

  async search<T = Record<string, unknown>>(
    collection: string,
    request: SearchRequest,
  ): Promise<SearchResults<T>> {
    const def = await this.requireCollection(collection);
    const hitsPerPage = Math.min(
      request.limit ?? this.defaultPageSize,
      this.maxPageSize,
    );
    const filter = this.buildFilter(def, request.filters);
    const sort = this.buildSort(def, request.sort);

    try {
      const result = await this.engine.search<T>(collection, {
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
        this.logger.warn(`Search failed on "${collection}": ${error.message}`);
        throw new ServiceUnavailableException('Search is temporarily unavailable');
      }
      throw error;
    }
  }

  private async requireCollection(name: string): Promise<CompiledCollection> {
    const def = await this.registry.resolve(name);
    if (!def) throw new NotFoundException(`Unknown collection "${name}"`);
    return def;
  }

  private buildFilter(
    def: CompiledCollection,
    filters?: Record<string, SearchFilterValue>,
  ): string[] {
    const clauses: string[] = [];
    for (const [field, value] of Object.entries(filters ?? {})) {
      if (!def.definition.filterableAttributes.includes(field)) {
        throw new BadRequestException(`Unknown filter field "${field}"`);
      }
      clauses.push(toFilterClause(field, value));
    }
    return clauses;
  }

  private buildSort(def: CompiledCollection, sort?: string[]): string[] {
    if (!sort) return [];
    return sort.map((entry) => {
      const [field, dir] = entry.split(':');
      if (
        !def.definition.sortableAttributes.includes(field) ||
        (dir !== 'asc' && dir !== 'desc')
      ) {
        throw new BadRequestException(`Invalid sort "${entry}"`);
      }
      return `${field}:${dir}`;
    });
  }

  private pickFacets(
    def: CompiledCollection,
    facets?: string[],
  ): string[] | undefined {
    if (!facets) return undefined;
    const invalid = facets.filter(
      (f) => !def.definition.filterableAttributes.includes(f),
    );
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
```

- [ ] **Step 4: Delete the superseded service + spec**

```bash
git rm src/features/search-service/search.service.ts \
  src/features/search-service/search.service.spec.ts
```

- [ ] **Step 5: Run the spec to verify it passes**

Run: `pnpm test -- src/features/search-service/search-record.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/search-service/search-record.service.ts \
  src/features/search-service/search-record.service.spec.ts
git commit -m "feat(search): SearchRecordService persist/delete/reload/query (global reads)"
```

---

### Task 7: DTOs

**Files:**
- Create: `src/features/search-service/dto/create-collection.dto.ts`
- Create: `src/features/search-service/dto/update-collection.dto.ts`
- Create: `src/features/search-service/dto/persist-records.dto.ts`
- Test: `src/features/search-service/dto/collection-dto.spec.ts`
- Keep unchanged: `src/features/search-service/dto/search-query.dto.ts`

**Interfaces:**
- Consumes: `validateFieldSpec` (Task 2), `FieldSpec` (Task 1), `zod`.
- Produces: `createCollectionSchema`/`CreateCollectionDto`, `updateCollectionSchema`/`UpdateCollectionDto`, `persistRecordsSchema`/`PersistRecordsDto`, plus the shared `fieldSpecSchema` + `refineFields`.

- [ ] **Step 1: Write the failing DTO spec**

Create `src/features/search-service/dto/collection-dto.spec.ts`:

```ts
import { createCollectionSchema } from './create-collection.dto';
import { persistRecordsSchema } from './persist-records.dto';

describe('createCollectionSchema', () => {
  const base = {
    name: 'articles',
    displayName: 'Articles',
    fields: [{ name: 'title', type: 'string', searchable: true }],
  };

  it('accepts a valid collection', () => {
    expect(createCollectionSchema.safeParse(base).success).toBe(true);
  });

  it('rejects an invalid name', () => {
    expect(createCollectionSchema.safeParse({ ...base, name: 'Bad Name' }).success).toBe(false);
  });

  it('rejects a spec with no searchable field (via validateFieldSpec)', () => {
    const res = createCollectionSchema.safeParse({
      ...base,
      fields: [{ name: 'n', type: 'number', filterable: true }],
    });
    expect(res.success).toBe(false);
  });

  it('rejects a reserved field name', () => {
    const res = createCollectionSchema.safeParse({
      ...base,
      fields: [{ name: 'id', type: 'string', searchable: true }],
    });
    expect(res.success).toBe(false);
  });
});

describe('persistRecordsSchema', () => {
  it('accepts a batch of records', () => {
    const res = persistRecordsSchema.safeParse({
      records: [{ externalId: 'a', document: { title: 'x' } }, { document: { title: 'y' } }],
    });
    expect(res.success).toBe(true);
  });

  it('rejects an empty batch', () => {
    expect(persistRecordsSchema.safeParse({ records: [] }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm test -- src/features/search-service/dto/collection-dto.spec.ts`
Expected: FAIL — `Cannot find module './create-collection.dto'`.

- [ ] **Step 3: Implement the create-collection DTO**

Create `src/features/search-service/dto/create-collection.dto.ts`:

```ts
import { z } from 'zod';
import type { FieldSpec } from '../../../infrastructure/database/schema/search.schema';
import { validateFieldSpec } from '../document-validator';

const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'string[]',
  'number[]',
] as const;

/** One field-spec entry. Structural cross-field rules run in `validateFieldSpec`. */
export const fieldSpecSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  searchable: z.boolean().optional(),
  filterable: z.boolean().optional(),
  sortable: z.boolean().optional(),
  enum: z.array(z.union([z.string(), z.number()])).optional(),
});

/** Attach `validateFieldSpec` errors as Zod issues on a `fields` array. */
export function refineFields(
  fields: FieldSpec[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!fields) return;
  for (const message of validateFieldSpec(fields)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['fields'] });
  }
}

export const createCollectionSchema = z
  .object({
    name: z
      .string()
      .regex(/^[a-z][a-z0-9_]*$/, 'name must be lower_snake_case')
      .max(100),
    displayName: z.string().min(1).max(255),
    description: z.string().max(500).optional(),
    fields: z.array(fieldSpecSchema).min(1),
  })
  .superRefine((val, ctx) => refineFields(val.fields as FieldSpec[], ctx));

export type CreateCollectionDto = z.infer<typeof createCollectionSchema>;
```

- [ ] **Step 4: Implement the update-collection DTO**

Create `src/features/search-service/dto/update-collection.dto.ts`:

```ts
import { z } from 'zod';
import type { FieldSpec } from '../../../infrastructure/database/schema/search.schema';
import { fieldSpecSchema, refineFields } from './create-collection.dto';

export const updateCollectionSchema = z
  .object({
    displayName: z.string().min(1).max(255).optional(),
    description: z.string().max(500).nullable().optional(),
    fields: z.array(fieldSpecSchema).min(1).optional(),
  })
  .superRefine((val, ctx) =>
    refineFields(val.fields as FieldSpec[] | undefined, ctx),
  );

export type UpdateCollectionDto = z.infer<typeof updateCollectionSchema>;
```

- [ ] **Step 5: Implement the persist-records DTO**

Create `src/features/search-service/dto/persist-records.dto.ts`:

```ts
import { z } from 'zod';

/** A batch of records to persist. `externalId` enables idempotent upsert. */
export const persistRecordsSchema = z.object({
  records: z
    .array(
      z.object({
        externalId: z.string().min(1).max(255).optional(),
        document: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(1000),
});

export type PersistRecordsDto = z.infer<typeof persistRecordsSchema>;
```

- [ ] **Step 6: Run the spec to verify it passes**

Run: `pnpm test -- src/features/search-service/dto/collection-dto.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/search-service/dto/create-collection.dto.ts \
  src/features/search-service/dto/update-collection.dto.ts \
  src/features/search-service/dto/persist-records.dto.ts \
  src/features/search-service/dto/collection-dto.spec.ts
git commit -m "feat(search): collection + persist-records DTOs with field-spec validation"
```

---

### Task 8: Processor + reconciliation scheduler

**Files:**
- Rewrite: `src/features/search-service/processors/search-indexing.processor.ts`
- Rewrite: `src/features/search-service/processors/search-indexing.processor.spec.ts`
- Rewrite: `src/features/search-service/schedulers/search-reconciliation.scheduler.ts`
- Rewrite: `src/features/search-service/schedulers/search-reconciliation.scheduler.spec.ts`

**Interfaces:**
- Consumes: `SearchEngine`, `SearchRecordRepository`, `toMeiliDocument`, `INDEXING_JOB_OPTS`, all job constants + `RECONCILE_STALE_MS`, `SEARCH_INDEXING_QUEUE`.
- Produces: `SearchIndexingProcessor` handling `INDEX_RECORD_JOB`/`DELETE_RECORD_JOB`/`REINDEX_COLLECTION_JOB`/`RECONCILE_JOB`; `SearchReconciliationScheduler.scheduleReconciliation(everyMs?)`.

- [ ] **Step 1: Rewrite the failing processor spec**

Replace the entire contents of `src/features/search-service/processors/search-indexing.processor.spec.ts`:

```ts
import type { Job } from 'bullmq';
import type { SearchRecordRow } from '../../../infrastructure/database/schema/search.schema';
import { SearchIndexingProcessor } from './search-indexing.processor';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

function liveRow(over: Partial<SearchRecordRow> = {}): SearchRecordRow {
  return {
    id: 'rec-1',
    collection: 'articles',
    externalId: 'ext-1',
    document: { title: 'Hi' },
    checksum: 'c',
    indexState: 'PENDING',
    indexError: null,
    indexedAt: null,
    isDeleted: false,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  } as SearchRecordRow;
}

function make(repoOverrides: Record<string, any> = {}) {
  const engine = {
    addOrReplace: jest.fn(async () => ({ taskUid: 1 })),
    deleteDocuments: jest.fn(async () => ({ taskUid: 2 })),
    clearIndex: jest.fn(async () => ({ taskUid: 3 })),
    waitForTask: jest.fn(async () => undefined),
  };
  const records = {
    findById: jest.fn(async () => liveRow()),
    markIndexState: jest.fn(async () => undefined),
    markCollectionIndexed: jest.fn(async () => undefined),
    pageLiveByCollection: jest.fn(async () => []),
    findUnsynced: jest.fn(async () => []),
    ...repoOverrides,
  };
  const queue = { add: jest.fn(async () => undefined) };
  const processor = new SearchIndexingProcessor(engine as never, records as never, queue as never);
  return { processor, engine, records, queue };
}

describe('SearchIndexingProcessor', () => {
  it('index-record adds a live row to Meili and marks it INDEXED', async () => {
    const { processor, engine, records } = make();
    await processor.process({ name: 'index-record', data: { id: 'rec-1' } } as Job);
    expect(engine.addOrReplace).toHaveBeenCalledWith(
      'articles',
      [expect.objectContaining({ id: 'rec-1', title: 'Hi' })],
    );
    expect(engine.waitForTask).toHaveBeenCalledWith(1);
    expect(records.markIndexState).toHaveBeenCalledWith(
      'rec-1',
      'INDEXED',
      expect.objectContaining({ indexError: null }),
    );
  });

  it('index-record deletes from Meili when the row is soft-deleted', async () => {
    const { processor, engine } = make({ findById: jest.fn(async () => liveRow({ isDeleted: true })) });
    await processor.process({ name: 'index-record', data: { id: 'rec-1' } } as Job);
    expect(engine.deleteDocuments).toHaveBeenCalledWith('articles', ['rec-1']);
    expect(engine.addOrReplace).not.toHaveBeenCalled();
  });

  it('index-record no-ops when the row is gone', async () => {
    const { processor, engine } = make({ findById: jest.fn(async () => null) });
    await processor.process({ name: 'index-record', data: { id: 'rec-1' } } as Job);
    expect(engine.addOrReplace).not.toHaveBeenCalled();
  });

  it('index-record marks FAILED and rethrows on engine error', async () => {
    const { records } = make();
    const engine = {
      addOrReplace: jest.fn(async () => {
        throw new Error('meili down');
      }),
      deleteDocuments: jest.fn(),
      clearIndex: jest.fn(),
      waitForTask: jest.fn(),
    };
    const proc = new SearchIndexingProcessor(
      engine as never,
      records as never,
      { add: jest.fn() } as never,
    );
    await expect(
      proc.process({ name: 'index-record', data: { id: 'rec-1' } } as Job),
    ).rejects.toThrow('meili down');
    expect(records.markIndexState).toHaveBeenCalledWith(
      'rec-1',
      'FAILED',
      expect.objectContaining({ indexError: 'meili down' }),
    );
  });

  it('delete-record deletes the document by id', async () => {
    const { processor, engine } = make();
    await processor.process({ name: 'delete-record', data: { collection: 'articles', id: 'rec-1' } } as Job);
    expect(engine.deleteDocuments).toHaveBeenCalledWith('articles', ['rec-1']);
  });

  it('reindex-collection clears then reloads live rows in pages', async () => {
    const page1 = [liveRow({ id: 'a' }), liveRow({ id: 'b' })];
    const pager = jest
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce([]);
    const { processor, engine, records } = make({ pageLiveByCollection: pager });
    await processor.process({ name: 'reindex-collection', data: { collection: 'articles' } } as Job);
    expect(engine.clearIndex).toHaveBeenCalledWith('articles');
    expect(engine.addOrReplace).toHaveBeenCalledWith('articles', [
      expect.objectContaining({ id: 'a' }),
      expect.objectContaining({ id: 'b' }),
    ]);
    expect(records.markCollectionIndexed).toHaveBeenCalledWith('articles');
  });

  it('reconcile re-enqueues unsynced records by state', async () => {
    const rows = [liveRow({ id: 'live-1' }), liveRow({ id: 'del-1', isDeleted: true })];
    const { processor, queue } = make({ findUnsynced: jest.fn(async () => rows) });
    await processor.process({ name: 'reconcile', data: {} } as Job);
    expect(queue.add).toHaveBeenCalledWith('index-record', { id: 'live-1' }, expect.anything());
    expect(queue.add).toHaveBeenCalledWith('delete-record', { collection: 'articles', id: 'del-1' }, expect.anything());
  });
});
```

- [ ] **Step 2: Run the processor spec to verify it fails**

Run: `pnpm test -- src/features/search-service/processors/search-indexing.processor.spec.ts`
Expected: FAIL (the current processor's constructor + job names differ).

- [ ] **Step 3: Rewrite the processor**

Replace the entire contents of `src/features/search-service/processors/search-indexing.processor.ts`:

```ts
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { SEARCH_ENGINE } from '../../../infrastructure/search-engine/meili.constants';
import type { SearchEngine } from '../../../infrastructure/search-engine/search-engine.interface';
import { SearchRecordRepository } from '../search-record.repository';
import {
  DELETE_RECORD_JOB,
  INDEX_RECORD_JOB,
  RECONCILE_JOB,
  RECONCILE_STALE_MS,
  REINDEX_COLLECTION_JOB,
  SEARCH_INDEXING_QUEUE,
} from '../search.constants';
import { INDEXING_JOB_OPTS, toMeiliDocument } from '../search.util';

const REINDEX_PAGE_SIZE = 500;

/**
 * Applies index mutations off the request path. Every job reads the current row
 * from Postgres (the source of truth) so Meili converges to the latest state and
 * rapid updates coalesce. Success stamps `INDEXED`; a throw stamps `FAILED` and
 * rethrows so BullMQ retries.
 */
@Processor(SEARCH_INDEXING_QUEUE)
export class SearchIndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(SearchIndexingProcessor.name);

  constructor(
    @Inject(SEARCH_ENGINE) private readonly engine: SearchEngine,
    private readonly records: SearchRecordRepository,
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case INDEX_RECORD_JOB:
        return this.indexRecord(this.requireString(job, 'id', job.data?.id));
      case DELETE_RECORD_JOB:
        return this.deleteRecord(
          this.requireString(job, 'collection', job.data?.collection),
          this.requireString(job, 'id', job.data?.id),
        );
      case REINDEX_COLLECTION_JOB:
        return this.reindexCollection(
          this.requireString(job, 'collection', job.data?.collection),
        );
      case RECONCILE_JOB:
        return this.reconcile();
      default:
        this.logger.warn(`Unknown job "${job.name}"`);
    }
  }

  private async indexRecord(id: string): Promise<void> {
    const row = await this.records.findById(id);
    if (!row) return;
    try {
      if (row.isDeleted) {
        const { taskUid } = await this.engine.deleteDocuments(row.collection, [id]);
        await this.engine.waitForTask(taskUid);
      } else {
        const { taskUid } = await this.engine.addOrReplace(row.collection, [
          toMeiliDocument(row),
        ]);
        await this.engine.waitForTask(taskUid);
      }
      await this.records.markIndexState(id, 'INDEXED', {
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (error) {
      await this.records.markIndexState(id, 'FAILED', {
        indexError: asMessage(error),
      });
      throw error;
    }
  }

  private async deleteRecord(collection: string, id: string): Promise<void> {
    try {
      const { taskUid } = await this.engine.deleteDocuments(collection, [id]);
      await this.engine.waitForTask(taskUid);
      await this.records.markIndexState(id, 'INDEXED', {
        indexedAt: new Date(),
        indexError: null,
      });
    } catch (error) {
      await this.records.markIndexState(id, 'FAILED', {
        indexError: asMessage(error),
      });
      throw error;
    }
  }

  private async reindexCollection(collection: string): Promise<void> {
    const cleared = await this.engine.clearIndex(collection);
    await this.engine.waitForTask(cleared.taskUid);

    let afterId: string | null = null;
    let total = 0;
    for (;;) {
      const page = await this.records.pageLiveByCollection(
        collection,
        REINDEX_PAGE_SIZE,
        afterId,
      );
      if (page.length === 0) break;
      const added = await this.engine.addOrReplace(
        collection,
        page.map(toMeiliDocument),
      );
      await this.engine.waitForTask(added.taskUid);
      total += page.length;
      afterId = page[page.length - 1].id;
      if (page.length < REINDEX_PAGE_SIZE) break;
    }
    await this.records.markCollectionIndexed(collection);
    this.logger.log(`Reindexed "${collection}" with ${total} documents`);
  }

  private async reconcile(): Promise<void> {
    const cutoff = new Date(Date.now() - RECONCILE_STALE_MS);
    const rows = await this.records.findUnsynced(cutoff, 500);
    for (const row of rows) {
      if (row.isDeleted) {
        await this.queue.add(
          DELETE_RECORD_JOB,
          { collection: row.collection, id: row.id },
          INDEXING_JOB_OPTS,
        );
      } else {
        await this.queue.add(INDEX_RECORD_JOB, { id: row.id }, INDEXING_JOB_OPTS);
      }
    }
    if (rows.length) this.logger.log(`Reconcile re-enqueued ${rows.length} records`);
  }

  private requireString(job: Job, field: string, value: unknown): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`Job "${job.name}": "${field}" must be a non-empty string`);
    }
    return value;
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Run the processor spec to verify it passes**

Run: `pnpm test -- src/features/search-service/processors/search-indexing.processor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the failing scheduler spec**

Replace the entire contents of `src/features/search-service/schedulers/search-reconciliation.scheduler.spec.ts`:

```ts
import { SearchReconciliationScheduler } from './search-reconciliation.scheduler';

/* eslint-disable @typescript-eslint/no-unsafe-argument */

describe('SearchReconciliationScheduler', () => {
  it('registers a single repeatable reconcile job', async () => {
    const queue = { add: jest.fn(async () => undefined) };
    const scheduler = new SearchReconciliationScheduler(queue as never);

    await scheduler.scheduleReconciliation(1000);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'reconcile',
      {},
      expect.objectContaining({ repeat: { every: 1000 }, jobId: 'search-reconcile' }),
    );
  });
});
```

- [ ] **Step 6: Run the scheduler spec to verify it fails**

Run: `pnpm test -- src/features/search-service/schedulers/search-reconciliation.scheduler.spec.ts`
Expected: FAIL (current scheduler constructor takes a registry and enqueues per-index `reindex` jobs).

- [ ] **Step 7: Rewrite the scheduler**

Replace the entire contents of `src/features/search-service/schedulers/search-reconciliation.scheduler.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RECONCILE_JOB, SEARCH_INDEXING_QUEUE } from '../search.constants';

/**
 * Registers a repeatable `reconcile` sweep. The processor consumes it and
 * re-enqueues any record that never converged (PENDING/FAILED beyond a
 * threshold) — the drift-repair path, since Postgres is the source of truth and
 * Meili is a rebuildable read model. Invoke `scheduleReconciliation` from an
 * ops/bootstrap hook once Redis is up (mirrors FileReconciliationScheduler).
 */
@Injectable()
export class SearchReconciliationScheduler {
  constructor(
    @InjectQueue(SEARCH_INDEXING_QUEUE) private readonly queue: Queue,
  ) {}

  async scheduleReconciliation(everyMs = 86_400_000): Promise<void> {
    await this.queue.add(
      RECONCILE_JOB,
      {},
      {
        repeat: { every: everyMs },
        jobId: 'search-reconcile',
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
```

- [ ] **Step 8: Run the scheduler spec to verify it passes**

Run: `pnpm test -- src/features/search-service/schedulers/search-reconciliation.scheduler.spec.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/features/search-service/processors/search-indexing.processor.ts \
  src/features/search-service/processors/search-indexing.processor.spec.ts \
  src/features/search-service/schedulers/search-reconciliation.scheduler.ts \
  src/features/search-service/schedulers/search-reconciliation.scheduler.spec.ts
git commit -m "feat(search): state-driven indexing processor + reconcile scheduler"
```

---

### Task 9: Controllers + module wiring

**Files:**
- Create: `src/features/search-service/collection.controller.ts`
- Create: `src/features/search-service/record.controller.ts`
- Rewrite: `src/features/search-service/search.controller.ts` → `SearchQueryController`
- Rewrite: `src/features/search-service/search-service.module.ts`

**Interfaces:**
- Consumes: `CollectionService`, `SearchRecordService`, DTOs (Tasks 5–7), `ZodValidationPipe`, `Roles`, repositories, `IndexRegistry`, processor, scheduler.
- Produces: three controllers + the updated module.

- [ ] **Step 1: Implement the collection controller**

Create `src/features/search-service/collection.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CollectionService } from './collection.service';
import {
  createCollectionSchema,
  type CreateCollectionDto,
} from './dto/create-collection.dto';
import {
  updateCollectionSchema,
  type UpdateCollectionDto,
} from './dto/update-collection.dto';

/**
 * Collection management. Mutations are admin-only; reads are open to any
 * authenticated principal so callers can discover what is queryable.
 */
@Controller('search/collections')
export class CollectionController {
  constructor(private readonly collections: CollectionService) {}

  @Post()
  @Roles('admin')
  create(
    @Body(new ZodValidationPipe(createCollectionSchema)) dto: CreateCollectionDto,
  ) {
    return this.collections.create(dto);
  }

  @Get()
  list() {
    return this.collections.list();
  }

  @Get(':name')
  get(@Param('name') name: string) {
    return this.collections.get(name);
  }

  @Patch(':name')
  @Roles('admin')
  update(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(updateCollectionSchema)) dto: UpdateCollectionDto,
  ) {
    return this.collections.update(name, dto);
  }

  @Delete(':name')
  @Roles('admin')
  @HttpCode(204)
  async remove(@Param('name') name: string): Promise<void> {
    await this.collections.remove(name);
  }
}
```

- [ ] **Step 2: Implement the record controller**

Create `src/features/search-service/record.controller.ts`:

```ts
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  persistRecordsSchema,
  type PersistRecordsDto,
} from './dto/persist-records.dto';
import { SearchRecordService } from './search-record.service';

/**
 * Record persistence. Admin-only: persist (upsert on externalId) and delete.
 * Writes land in Postgres and are indexed asynchronously (202 Accepted).
 */
@Controller('search/collections/:name/records')
@Roles('admin')
export class RecordController {
  constructor(private readonly records: SearchRecordService) {}

  @Post()
  @HttpCode(202)
  persist(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(persistRecordsSchema)) dto: PersistRecordsDto,
  ) {
    return this.records.persist(name, dto.records);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @Param('name') name: string,
    @Param('id') id: string,
  ): Promise<void> {
    await this.records.remove(name, id);
  }
}
```

- [ ] **Step 3: Rewrite the query controller**

Replace the entire contents of `src/features/search-service/search.controller.ts`:

```ts
import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { searchQuerySchema, type SearchQueryDto } from './dto/search-query.dto';
import { SearchRecordService } from './search-record.service';

/**
 * Query + reload surface. `POST .../query` is open to any authenticated
 * principal (global reads); `POST .../reload` is admin-only and runs the full
 * clear-and-rebuild through BullMQ.
 */
@Controller('search/collections/:name')
export class SearchQueryController {
  constructor(private readonly records: SearchRecordService) {}

  @Post('query')
  @HttpCode(200)
  query(
    @Param('name') name: string,
    @Body(new ZodValidationPipe(searchQuerySchema)) body: SearchQueryDto,
  ) {
    return this.records.search(name, body);
  }

  @Post('reload')
  @Roles('admin')
  @HttpCode(202)
  async reload(@Param('name') name: string): Promise<{ status: string }> {
    await this.records.reload(name);
    return { status: 'accepted' };
  }
}
```

- [ ] **Step 4: Rewrite the module**

Replace the entire contents of `src/features/search-service/search-service.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CollectionController } from './collection.controller';
import { CollectionRepository } from './collection.repository';
import { CollectionService } from './collection.service';
import { IndexRegistry } from './index-registry';
import { SearchIndexingProcessor } from './processors/search-indexing.processor';
import { RecordController } from './record.controller';
import { SearchReconciliationScheduler } from './schedulers/search-reconciliation.scheduler';
import { SearchQueryController } from './search.controller';
import { SEARCH_INDEXING_QUEUE } from './search.constants';
import { SearchRecordRepository } from './search-record.repository';
import { SearchRecordService } from './search-record.service';

/**
 * Search-service feature: a generic data processor. Admins manage collections
 * and persist records (Postgres = source of truth); everyone queries Meili.
 * Registers the `search-indexing` BullMQ queue. Depends on the global
 * SearchEngineModule (SEARCH_ENGINE), DatabaseModule (DRIZZLE), and QueueModule.
 */
@Module({
  imports: [BullModule.registerQueue({ name: SEARCH_INDEXING_QUEUE })],
  controllers: [CollectionController, RecordController, SearchQueryController],
  providers: [
    IndexRegistry,
    CollectionRepository,
    SearchRecordRepository,
    CollectionService,
    SearchRecordService,
    SearchIndexingProcessor,
    SearchReconciliationScheduler,
  ],
  exports: [SearchRecordService, CollectionService],
})
export class SearchServiceModule {}
```

- [ ] **Step 5: Full typecheck + build + unit suite**

Run: `pnpm typecheck && pnpm build && pnpm test -- src/features/search-service`
Expected: all PASS with no type errors (the whole feature now compiles end-to-end).

- [ ] **Step 6: Commit**

```bash
git add src/features/search-service/collection.controller.ts \
  src/features/search-service/record.controller.ts \
  src/features/search-service/search.controller.ts \
  src/features/search-service/search-service.module.ts
git commit -m "feat(search): collection/record/query controllers + module wiring"
```

---

### Task 10: End-to-end contract (authz matrix + persist→query + reload)

**Files:**
- Rewrite: `test/search.e2e-spec.ts`

**Interfaces:**
- Consumes: the full feature via the focused module set + real Postgres/Redis/Meili.

**Preconditions:** Postgres (`:30898`), Redis (`:30490`), and MeiliSearch reachable per `.env`; the migration from Task 1 applied.

- [ ] **Step 1: Apply the migration**

Run: `pnpm db:migrate`
Expected: applies the Task 1 migration; `collections` and `search_records` tables now exist.

- [ ] **Step 2: Rewrite the e2e spec**

Replace the entire contents of `test/search.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ConfigModule } from '../src/config/config.module';
import type { AuthConfig } from '../src/config/configurations/auth.config';
import { AuthModule } from '../src/features/auth/auth.module';
import { SearchServiceModule } from '../src/features/search-service/search-service.module';
import { UsersModule } from '../src/features/users/users.module';
import { UsersService } from '../src/features/users/users.service';
import { DatabaseModule } from '../src/infrastructure/database/database.module';
import { QueueModule } from '../src/infrastructure/queue/queue.module';
import { SearchEngineModule } from '../src/infrastructure/search-engine/search-engine.module';

/**
 * Search data-processor e2e. Boots a focused module subset (never AppModule) to
 * avoid the Mastra ESM/Jest break. Requires Postgres + Redis + MeiliSearch.
 * Run with `pnpm test:e2e -- search.e2e`.
 */
describe('Search Management API (e2e)', () => {
  let app: INestApplication;
  const stamp = String(Date.now());
  const collection = `articles_${stamp}`;
  const adminEmail = `search_admin_${stamp}@e2e.local`;
  const userEmail = `search_user_${stamp}@e2e.local`;
  const pass = 'search-e2e-password-123';
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        DatabaseModule,
        QueueModule,
        SearchEngineModule,
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (c: ConfigService) => {
            const a = c.getOrThrow<AuthConfig>('auth');
            return [{ ttl: a.throttleTtl * 1000, limit: 10_000 }];
          },
        }),
        AuthModule,
        UsersModule,
        SearchServiceModule,
      ],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    const users = app.get(UsersService);
    await users.create({ email: adminEmail, password: pass, role: 'admin' });
    await users.create({ email: userEmail, password: pass, role: 'user' });

    const login = async (email: string) =>
      (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password: pass })
          .expect(200)
      ).body.accessToken;
    adminToken = await login(adminEmail);
    userToken = await login(userEmail);
  });

  afterAll(async () => {
    await app?.close();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${adminToken}`);
  const asUser = (r: request.Test) => r.set('Authorization', `Bearer ${userToken}`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('rejects unauthenticated collection creation', async () => {
    await request(server()).post('/search/collections').send({}).expect(401);
  });

  it('forbids a non-admin from creating a collection', async () => {
    await asUser(request(server()).post('/search/collections'))
      .send({
        name: collection,
        displayName: 'Articles',
        fields: [{ name: 'title', type: 'string', searchable: true }],
      })
      .expect(403);
  });

  it('lets an admin create a collection', async () => {
    await asAdmin(request(server()).post('/search/collections'))
      .send({
        name: collection,
        displayName: 'Articles',
        fields: [
          { name: 'title', type: 'string', required: true, searchable: true, sortable: true },
          { name: 'status', type: 'string', filterable: true, enum: ['draft', 'live'] },
        ],
      })
      .expect(201);
  });

  it('rejects an invalid field-spec (no searchable field)', async () => {
    await asAdmin(request(server()).post('/search/collections'))
      .send({
        name: `bad_${stamp}`,
        displayName: 'Bad',
        fields: [{ name: 'n', type: 'number', filterable: true }],
      })
      .expect(400);
  });

  it('forbids a non-admin from persisting records', async () => {
    await asUser(request(server()).post(`/search/collections/${collection}/records`))
      .send({ records: [{ document: { title: 'x' } }] })
      .expect(403);
  });

  it('400s a document that fails validation', async () => {
    await asAdmin(request(server()).post(`/search/collections/${collection}/records`))
      .send({ records: [{ document: { title: 123 } }] })
      .expect(400);
  });

  it('persists records (202) and makes them queryable after indexing', async () => {
    await asAdmin(request(server()).post(`/search/collections/${collection}/records`))
      .send({
        records: [
          { externalId: 'a1', document: { title: 'Hello world', status: 'live' } },
          { externalId: 'a2', document: { title: 'Draft note', status: 'draft' } },
        ],
      })
      .expect(202);

    // Indexing is async; poll briefly for eventual consistency.
    let hits = 0;
    for (let i = 0; i < 20 && hits === 0; i++) {
      await sleep(250);
      const res = await asUser(
        request(server()).post(`/search/collections/${collection}/query`),
      ).send({ q: 'hello' });
      if (res.status === 200) hits = res.body.totalHits;
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('lets a user filter on an allowlisted field', async () => {
    const res = await asUser(
      request(server()).post(`/search/collections/${collection}/query`),
    )
      .send({ q: '', filters: { status: 'live' } })
      .expect(200);
    expect(res.body.hits.every((h: { status: string }) => h.status === 'live')).toBe(true);
  });

  it('rejects a filter on a non-allowlisted field', async () => {
    await asUser(request(server()).post(`/search/collections/${collection}/query`))
      .send({ q: '', filters: { title: 'x' } })
      .expect(400);
  });

  it('404s querying an unknown collection', async () => {
    await asUser(request(server()).post('/search/collections/does_not_exist/query'))
      .send({ q: 'x' })
      .expect(404);
  });

  it('lets an admin reload a collection', async () => {
    await asAdmin(request(server()).post(`/search/collections/${collection}/reload`)).expect(202);
  });

  it('forbids a non-admin from reloading', async () => {
    await asUser(request(server()).post(`/search/collections/${collection}/reload`)).expect(403);
  });
});
```

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm test:e2e -- search.e2e`
Expected: PASS (all cases). If the persist→query poll flakes, confirm MeiliSearch is reachable and the queue worker is processing (Redis up).

- [ ] **Step 4: Full regression + commit**

Run: `pnpm test && pnpm test:e2e -- search.e2e`
Expected: green.

```bash
git add test/search.e2e-spec.ts
git commit -m "test(search): e2e authz matrix, persist->query, filters, reload"
```

---

## Self-Review

**Spec coverage** (design §-by-§ → task):
- §2 decisions: JSONB store (T1) · dynamic collections (T1,T3,T5) · field-spec (T1,T2) · global reads (T6) · eventual consistency (T6,T8) · outbox via `indexState` (T1,T8). ✓
- §3 layering: controllers (T9) · services (T5,T6) · repos (T3) · registry (T4) · validator (T2) · processor/scheduler (T8). ✓
- §4 schema + field-spec + rationale: T1, T2. ✓
- §5 API + authz matrix + DTOs: T9, T7. ✓
- §6 write/sync flow (upsert, checksum-skip, 202, id-keyed job, state-driven index): T6, T8. ✓
- §7 reconciliation + boot convergence + PATCH-triggers-reload: T8, T5. ✓
- §8 error/edge cases (404/400/409/503/purge): T5, T6, T9, T10. ✓
- §9 testing (unit/repo/processor/e2e, focused-module boot, meilisearch pin): T2,T4,T5,T6,T7,T8,T10. ✓
- §10 change-set (new/changed/retired incl. `search.service.ts` deletion, `ownerScope` removal, static registry drop): T4,T6,T9. ✓

**Type consistency:** job constants (`INDEX_RECORD_JOB` etc.), `CompiledCollection`, `PersistResult`, `RecordInput`, `CollectionView`, repo method names, and `SearchEngine.deleteIndex` are defined once (T1/T2/T3/T4/T5) and referenced with identical signatures downstream. Controllers call `records.persist(name, dto.records)` matching `persist(collection, RecordInput[])`. ✓

**Placeholders:** none — every code and test step is complete.
