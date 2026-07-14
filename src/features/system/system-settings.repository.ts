import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, type SQL } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  systemSettings,
  type NewSystemSettingRow,
  type SystemSettingRow,
} from '../../infrastructure/database/schema/system.schema';

@Injectable()
export class SystemSettingsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async findByKey(key: string): Promise<SystemSettingRow | null> {
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(
        and(eq(systemSettings.key, key), eq(systemSettings.isDeleted, false)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async list(q: {
    category?: string;
    page: number;
    limit: number;
  }): Promise<{ rows: SystemSettingRow[]; total: number }> {
    const filters: SQL[] = [eq(systemSettings.isDeleted, false)];
    if (q.category) filters.push(eq(systemSettings.category, q.category));
    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(where)
      .orderBy(systemSettings.key)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit);
    const totals = await this.db
      .select({ value: count() })
      .from(systemSettings)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  /** Insert or update by key (soft-delete-aware). */
  async upsertByKey(
    key: string,
    patch: Omit<NewSystemSettingRow, 'key'>,
  ): Promise<SystemSettingRow> {
    const existing = await this.findByKey(key);
    if (existing) {
      const rows = await this.db
        .update(systemSettings)
        .set(patch)
        .where(eq(systemSettings.id, existing.id))
        .returning();
      return rows[0];
    }
    const rows = await this.db
      .insert(systemSettings)
      .values({ key, ...patch })
      .returning();
    return rows[0];
  }

  async softDelete(key: string): Promise<boolean> {
    const rows = await this.db
      .update(systemSettings)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(
        and(eq(systemSettings.key, key), eq(systemSettings.isDeleted, false)),
      )
      .returning();
    return rows.length > 0;
  }
}
