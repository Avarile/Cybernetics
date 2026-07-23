import { Injectable } from '@nestjs/common';
import { MastraService } from '@mastra/nestjs';
import { AGENT_ID } from '../mastra.constants';
import type { PrincipalRef } from '../mastra.types';
import { AgentRunRepository } from '../repositories/agent-run.repository';
import { ApprovalRepository } from '../repositories/approval.repository';
import { buildRequestContext } from './mastra-adapters';
import { ConversationService } from './conversation.service';
import { actionTypeForTool, chunkToSse, sseFrame, type SseEvent } from './chunk-to-sse';

export interface StreamSink {
  write(frame: string): void;
}
interface StreamInput {
  conversationId?: string;
  message?: string;
  resume?: { approvalId: string; approved: boolean };
}
interface Suspend {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

@Injectable()
export class ChatStreamService {
  constructor(
    private readonly conversations: ConversationService,
    private readonly runs: AgentRunRepository,
    private readonly approvals: ApprovalRepository,
    private readonly mastra: MastraService,
  ) {}

  async stream(principal: PrincipalRef, input: StreamInput, sink: StreamSink): Promise<void> {
    if (input.resume) {
      await this.resume(principal, input.resume, sink);
      return;
    }
    const conv = await this.conversations.ensure(principal, input.conversationId, 'chat');
    const run = await this.runs.create({
      conversationId: conv.id,
      trigger: 'user_message',
      triggeredByUserId: principal.id,
      status: 'running',
      agentId: AGENT_ID,
      input: { message: input.message },
      startedAt: new Date(),
    } as never);
    const emit = (e: SseEvent) => sink.write(sseFrame(e));
    emit({ type: 'start', conversationId: conv.id, runId: run.id });

    try {
      const agent = this.mastra.getAgent(AGENT_ID);
      const output = await agent.stream(input.message as string, {
        memory: { resource: conv.resourceId, thread: { id: conv.id } },
        requestContext: buildRequestContext({ principal, runId: run.id, conversationId: conv.id }),
      } as never);

      const { suspend, mastraRunId } = await this.pump(output as never, emit);
      await this.finishTurn(run.id, conv, output as never, suspend, mastraRunId, emit);
    } catch (err) {
      await this.runs.finish(run.id, {
        status: 'failed',
        error: { message: err instanceof Error ? err.message : String(err) },
        finishedAt: new Date(),
      } as never);
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      emit({ type: 'done', status: 'failed' });
    }
  }

  /** Consume the Mastra stream, forwarding client-facing chunks; capture suspend + runId. */
  private async pump(
    output: { fullStream: AsyncIterable<{ type: string; runId?: string; payload?: Record<string, unknown> }> },
    emit: (e: SseEvent) => void,
  ): Promise<{ suspend: Suspend | null; mastraRunId: string | null }> {
    let suspend: Suspend | null = null;
    let mastraRunId: string | null = null;
    for await (const chunk of output.fullStream) {
      mastraRunId ??= chunk.runId ?? null;
      if (chunk.type === 'tool-call-approval' || chunk.type === 'tool-call-suspended') {
        const p = chunk.payload ?? {};
        suspend = { toolCallId: String(p.toolCallId ?? ''), toolName: String(p.toolName ?? ''), args: (p.args as Record<string, unknown>) ?? {} };
        continue;
      }
      const event = chunkToSse(chunk);
      if (event) emit(event);
    }
    return { suspend, mastraRunId };
  }

  private async finishTurn(
    runId: string,
    conv: { id: string },
    output: { text: Promise<string>; usage: Promise<{ inputTokens?: number; outputTokens?: number }>; finishReason: Promise<string | undefined> },
    suspend: Suspend | null,
    mastraRunId: string | null,
    emit: (e: SseEvent) => void,
  ): Promise<void> {
    const reason = await output.finishReason;
    if (suspend || reason === 'suspended') {
      const s = suspend as Suspend;
      const appr = await this.approvals.create({
        runId,
        conversationId: conv.id,
        mastraRunId,
        toolCallId: s.toolCallId,
        actionType: actionTypeForTool(s.toolName),
        title: `Approve ${s.toolName}`,
        payload: s.args,
        status: 'pending',
      } as never);
      await this.runs.finish(runId, { status: 'awaiting_approval', finishedAt: new Date() } as never);
      emit({ type: 'approval-required', approvalId: appr.id, toolCallId: s.toolCallId, toolName: s.toolName, actionType: actionTypeForTool(s.toolName), title: `Approve ${s.toolName}`, payload: s.args });
      emit({ type: 'done', status: 'awaiting_approval' });
      return;
    }
    const [text, usage] = await Promise.all([output.text, output.usage]);
    await this.runs.finish(runId, {
      status: 'succeeded',
      output: { text },
      tokensInput: usage.inputTokens,
      tokensOutput: usage.outputTokens,
      finishedAt: new Date(),
    } as never);
    await this.conversations.touch(conv.id);
    emit({ type: 'done', status: 'succeeded' });
  }

  // resume(...) is added in Task 9.
  private async resume(_p: PrincipalRef, _r: { approvalId: string; approved: boolean }, _s: StreamSink): Promise<void> {
    throw new Error('not implemented'); // replaced in Task 9
  }
}
