import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../infrastructure/database/repositories/base.repository';
import {
  users,
  type NewUserRow,
  type UserRow,
} from '../../infrastructure/database/schema/identity.schema';

/** Repository for the `users` table — soft-delete aware. */
@Injectable()
export class UserRepository extends BaseRepository<typeof users> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, users);
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveById(id: string): Promise<UserRow | null> {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.isDeleted, false)))
      .limit(1);
    return rows[0] ?? null;
  }

  async update(
    id: string,
    patch: Partial<NewUserRow>,
  ): Promise<UserRow | null> {
    const rows = await this.db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ isDeleted: true, deletedAt: new Date() })
      .where(eq(users.id, id));
  }

  async list(
    page: number,
    limit: number,
  ): Promise<{ rows: UserRow[]; total: number }> {
    const where = eq(users.isDeleted, false);
    const rows = await this.db
      .select()
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const totals = await this.db
      .select({ value: count() })
      .from(users)
      .where(where);
    return { rows, total: Number(totals[0]?.value ?? 0) };
  }

  async stampLogin(id: string): Promise<void> {
    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id));
  }

  async countByRole(role: UserRow['role']): Promise<number> {
    const totals = await this.db
      .select({ value: count() })
      .from(users)
      .where(and(eq(users.role, role), eq(users.isDeleted, false)));
    return Number(totals[0]?.value ?? 0);
  }
}
