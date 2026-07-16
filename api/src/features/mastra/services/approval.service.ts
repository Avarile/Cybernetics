import { Injectable, Logger } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import {
  ErrorCode,
  ExceptionService,
} from '../../../infrastructure/exceptions';
import { AGENT_ID } from '../mastra.constants';
import type { PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { ConversationService } from './conversation.service';
import { resumeAfterApproval } from './mastra-adapters';

export interface DecisionInput {
  approved: boolean;
  note?: string;
}

/**
 * Human-in-the-loop resume path: lists pending `agent_approval` rows for a
 * principal and resolves a decision by resuming the suspended Mastra
 * `generate()` call (see `mastra-adapters.ts::resumeAfterApproval` for the
 * confirmed resume API), then reconciling both the approval row and the
 * originating `agent_run` ledger entry.
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly runs: AgentRunRepository,
    private readonly mastra: MastraService,
    private readonly conversations: ConversationService,
    private readonly errors: ExceptionService,
  ) {}

  async listForOwner(principal: PrincipalRef) {
    return this.approvals.findPendingForOwner(principal.id, principal.role);
  }

  async decide(principal: PrincipalRef, id: string, decision: DecisionInput) {
    const appr = await this.approvals.findById(id);
    if (!appr) throw this.errors.create(ErrorCode.AGENT_APPROVAL_NOT_FOUND);
    if (appr.status !== 'pending') {
      throw this.errors.create(ErrorCode.AGENT_APPROVAL_CONFLICT);
    }

    // Ownership gate: the GET path (`findPendingForOwner`) already scopes by
    // owner, but this mutation resumes a real side-effect (send-email/db-write),
    // so it must not be resolvable by an arbitrary authenticated caller.
    // Admins bypass; everyone else must own the approval's conversation.
    if (principal.role !== 'admin') {
      if (!appr.conversationId) {
        throw this.errors.create(ErrorCode.AGENT_APPROVAL_FORBIDDEN);
      }
      // Throws FORBIDDEN/AGENT_CONVERSATION_NOT_FOUND for a non-owner.
      await this.conversations.getOwned(principal, appr.conversationId);
    }

    try {
      await resumeAfterApproval(this.mastra.getAgent(AGENT_ID) as never, {
        mastraRunId: appr.mastraRunId,
        toolCallId: appr.toolCallId,
        approved: decision.approved,
      });
    } catch (err) {
      // Resume itself failed: no side-effect happened, safe to mark failed.
      await this.approvals.decide(id, {
        status: 'failed',
        decidedByUserId: principal.id,
        decidedAt: new Date(),
        result: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }

    // Resume succeeded — the tool call (and any real side-effect) already
    // happened. A failure reconciling our own ledger below must NOT be
    // reported as an approval failure (that would contradict a side-effect
    // that actually occurred), so it gets its own try/catch that never
    // touches approval status.
    try {
      await this.approvals.decide(id, {
        status: decision.approved ? 'executed' : 'rejected',
        decidedByUserId: principal.id,
        decidedAt: new Date(),
        decisionNote: decision.note ?? null,
      });
      await this.runs.finish(appr.runId, {
        status: decision.approved ? 'succeeded' : 'cancelled',
        finishedAt: new Date(),
      });
    } catch (err) {
      this.logger.error(
        `Approval ${id} resumed successfully but reconciling the approval/run ` +
          `ledger failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    return { id, status: decision.approved ? 'executed' : 'rejected' };
  }
}
