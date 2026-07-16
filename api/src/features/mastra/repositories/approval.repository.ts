import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  DRIZZLE,
  type DrizzleDB,
} from '../../../infrastructure/database/drizzle.constants';
import { BaseRepository } from '../../../infrastructure/database/repositories/base.repository';
import {
  agentApprovals,
  agentConversations,
  type AgentApprovalRow,
  type NewAgentApprovalRow,
} from '../../../infrastructure/database/schema/agent.schema';

/**
 * Repository for the `agent_approval` table (pending human-in-the-loop decisions).
 *
 * `create` and `findById` are inherited from `BaseRepository`.
 */
@Injectable()
export class ApprovalRepository extends BaseRepository<typeof agentApprovals> {
  constructor(@Inject(DRIZZLE) db: DrizzleDB) {
    super(db, agentApprovals);
  }

  /** Patch a pending approval with a decision (status, decidedBy, result, ...). */
  async decide(id: string, patch: Partial<NewAgentApprovalRow>): Promise<void> {
    await this.db
      .update(agentApprovals)
      .set(patch)
      .where(eq(agentApprovals.id, id));
  }

  /**
   * Pending, non-deleted approvals visible to `userId`.
   * Admins see every pending approval; other users see only approvals whose
   * conversation they own.
   */
  async findPendingForOwner(
    userId: string | null,
    role?: string,
  ): Promise<AgentApprovalRow[]> {
    if (role === 'admin') {
      return this.db
        .select()
        .from(agentApprovals)
        .where(
          and(
            eq(agentApprovals.status, 'pending'),
            eq(agentApprovals.isDeleted, false),
          ),
        );
    }
    if (!userId) return [];
    const rows = await this.db
      .select({ approval: agentApprovals })
      .from(agentApprovals)
      .innerJoin(
        agentConversations,
        eq(agentApprovals.conversationId, agentConversations.id),
      )
      .where(
        and(
          eq(agentApprovals.status, 'pending'),
          eq(agentApprovals.isDeleted, false),
          eq(agentConversations.ownerUserId, userId),
        ),
      );
    return rows.map((r) => r.approval);
  }
}
