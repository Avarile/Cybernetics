import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';
import {
  agentConversations,
  type AgentConversationRow,
} from '../../../infrastructure/database/schema/agent.schema';

/** Repository for the `agent_conversation` table (thin metadata over a Mastra thread). */
@Injectable()
export class ConversationRepository extends BaseRepository<
  typeof agentConversations
> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, agentConversations);
  }

  /** A live (non-deleted) conversation by id. */
  async findLiveById(id: string): Promise<AgentConversationRow | null> {
    const rows = await this.db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.id, id),
          eq(agentConversations.isDeleted, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Live conversations owned by a user, newest activity first. */
  async listByOwner(
    ownerUserId: string,
    page: number,
    limit: number,
  ): Promise<AgentConversationRow[]> {
    return this.db
      .select()
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.ownerUserId, ownerUserId),
          eq(agentConversations.isDeleted, false),
        ),
      )
      .orderBy(desc(agentConversations.lastMessageAt))
      .limit(limit)
      .offset((page - 1) * limit);
  }

  /** Bump `lastMessageAt` and increment `messageCount` for a conversation. */
  async touch(id: string): Promise<void> {
    await this.db
      .update(agentConversations)
      .set({
        lastMessageAt: new Date(),
        messageCount: sql`${agentConversations.messageCount} + 1`,
      })
      .where(eq(agentConversations.id, id));
  }
}
