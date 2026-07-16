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
