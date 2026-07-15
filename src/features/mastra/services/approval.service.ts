import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import { AGENT_ID } from '../mastra.constants';
import type { PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
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
  constructor(
    private readonly approvals: ApprovalRepository,
    private readonly runs: AgentRunRepository,
    private readonly mastra: MastraService,
  ) {}

  async listForOwner(principal: PrincipalRef) {
    return this.approvals.findPendingForOwner(principal.id, principal.role);
  }

  async decide(principal: PrincipalRef, id: string, decision: DecisionInput) {
    const appr = await this.approvals.findById(id);
    if (!appr) throw new NotFoundException('Approval not found');
    if (appr.status !== 'pending') {
      throw new ConflictException('Approval already decided');
    }

    try {
      await resumeAfterApproval(this.mastra.getAgent(AGENT_ID) as never, {
        mastraRunId: appr.mastraRunId,
        toolCallId: appr.toolCallId,
        approved: decision.approved,
      });
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
      return { id, status: decision.approved ? 'executed' : 'rejected' };
    } catch (err) {
      await this.approvals.decide(id, {
        status: 'failed',
        decidedByUserId: principal.id,
        decidedAt: new Date(),
        result: { error: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  }
}
