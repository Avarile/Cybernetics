import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  files,
  type FileRow,
  type NewFileRow,
} from '../../infrastructure/database/schema/file.schema';

/** Repository for the `files` table — domain queries over the base CRUD. */
@Injectable()
export class FileRepository extends BaseRepository<typeof files> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, files);
  }

  /** An already-stored, available object with this content hash (for dedup). */
  async findAvailableByChecksum(checksum: string): Promise<FileRow | null> {
    const rows = await this.db
      .select()
      .from(files)
      .where(
        and(eq(files.checksumSha256, checksum), eq(files.status, 'AVAILABLE')),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Paginated, owner-scoped listing (soft-deleted rows excluded). */
  async findByOwner(
    ownerId: string | null,
    page: number,
    limit: number,
    filters: { status?: FileRow['status']; mimeType?: string },
  ): Promise<{ rows: FileRow[]; total: number }> {
    const conditions = [
      ownerId === null ? isNull(files.ownerId) : eq(files.ownerId, ownerId),
      eq(files.isDeleted, false),
    ];
    if (filters.status) conditions.push(eq(files.status, filters.status));
    if (filters.mimeType) conditions.push(eq(files.mimeType, filters.mimeType));
    const where = and(...conditions);

    const rows = await this.db
      .select()
      .from(files)
      .where(where)
      .orderBy(desc(files.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);

    const totals = await this.db
      .select({ value: count() })
      .from(files)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** PENDING rows whose upload never completed before the cutoff. */
  async findStalePending(olderThan: Date): Promise<FileRow[]> {
    return this.db
      .select()
      .from(files)
      .where(and(eq(files.status, 'PENDING'), lt(files.createdAt, olderThan)));
  }

  /** Soft-deleted rows eligible for object purge + hard-delete. */
  async findPurgeable(limit = 500): Promise<FileRow[]> {
    return this.db
      .select()
      .from(files)
      .where(eq(files.isDeleted, true))
      .limit(limit);
  }

  /** Transition status (with an optional column patch); returns the new row. */
  async markStatus(
    id: string,
    status: FileRow['status'],
    patch: Partial<NewFileRow> = {},
  ): Promise<FileRow | null> {
    const rows = await this.db
      .update(files)
      .set({ status, ...patch })
      .where(eq(files.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(files)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(files.id, id));
  }

  /** Count of live (non-deleted) rows sharing an object — purge gate. */
  async countLiveReferences(objectKey: string): Promise<number> {
    const totals = await this.db
      .select({ value: count() })
      .from(files)
      .where(and(eq(files.objectKey, objectKey), eq(files.isDeleted, false)));
    return Number(totals[0]?.value ?? 0);
  }

  async hardDelete(id: string): Promise<void> {
    await this.db.delete(files).where(eq(files.id, id));
  }
}
