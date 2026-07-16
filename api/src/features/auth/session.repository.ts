import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../infrastructure/database/drizzle.constants';
import {
  sessions,
  type NewSessionRow,
  type SessionRow,
} from '../../infrastructure/database/schema/identity.schema';

/** Access to the `sessions` (refresh-token) table. */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(row: NewSessionRow): Promise<SessionRow> {
    const rows = await this.db.insert(sessions).values(row).returning();
    return rows[0];
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRow | null> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return rows[0] ?? null;
  }

  async revokeById(id: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, id));
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  async listActiveForUser(userId: string): Promise<SessionRow[]> {
    return this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
  }
}
