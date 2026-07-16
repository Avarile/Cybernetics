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
