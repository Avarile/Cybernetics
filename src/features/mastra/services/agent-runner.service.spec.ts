// `@mastra/nestjs`'s build pulls in Mastra's server/editor stack (ESM-only transitive
// deps), which breaks under Jest's default transformIgnorePatterns. `AgentRunnerService`
// only uses `MastraService` for its type (DI token) and calls `.getAgent(...)` on the
// injected instance, so stub the module rather than loading the real one.
jest.mock('@mastra/nestjs', () => ({ MastraService: class {} }));

import { AgentRunnerService } from './agent-runner.service';

/**
 * `genResult` fixtures below mirror the CONFIRMED real shape of
 * `Agent.generate()`'s resolved `FullOutput` (node_modules/@mastra/core 1.50.1,
 * `dist/stream/base/output.d.ts` + `dist/docs/references/docs-agents-agent-approval.md`):
 * `finishReason` (not `status`) signals completion state, and a required tool approval
 * surfaces as `finishReason: 'suspended'` with a single `suspendPayload` object (not a
 * `toolCalls` array) — see `mastra-adapters.ts` for the full citation.
 */
function make(genResult: unknown) {
  const conversations = {
    ensure: jest.fn(async () => ({
      id: 'conv-1',
      ownerUserId: 'u1',
      resourceId: 'u1',
    })),
    touch: jest.fn(async () => undefined),
  };
  const runs = {
    create: jest.fn(async () => ({ id: 'run-1' })),
    finish: jest.fn(async () => undefined),
  };
  const approvals = { create: jest.fn(async () => ({ id: 'appr-1' })) };
  const agent = { generate: jest.fn(async () => genResult) };
  const mastra = { getAgent: jest.fn(() => agent) };
  const service = new AgentRunnerService(
    conversations as never,
    runs as never,
    approvals as never,
    mastra as never,
  );
  return { service, conversations, runs, approvals, agent, mastra };
}

describe('AgentRunnerService.runChat', () => {
  it('runs a turn, records the run, and returns text', async () => {
    const { service, runs, conversations } = make({
      finishReason: 'stop',
      text: 'Answer',
      totalUsage: { inputTokens: 10, outputTokens: 5 },
      response: { modelId: 'gpt-4o' },
      runId: 'mastra-run-1',
    });
    const res = await service.runChat({ id: 'u1' }, { message: 'hi' });
    expect(res.text).toBe('Answer');
    expect(res.pendingApprovals).toHaveLength(0);
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'succeeded',
        tokensInput: 10,
        tokensOutput: 5,
        model: 'gpt-4o',
      }),
    );
    expect(conversations.touch).toHaveBeenCalledWith('conv-1');
  });

  it('persists pending approvals and marks the run awaiting_approval', async () => {
    const { service, approvals, runs } = make({
      finishReason: 'suspended',
      text: '',
      suspendPayload: {
        toolCallId: 'tc1',
        toolName: 'send-email',
        args: { to: 'a@b.com' },
      },
      runId: 'mastra-run-2',
    });
    const res = await service.runChat(
      { id: 'u1' },
      { message: 'email a@b.com' },
    );
    expect(res.pendingApprovals).toHaveLength(1);
    expect(approvals.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        actionType: 'send_email',
        toolCallId: 'tc1',
      }),
    );
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'awaiting_approval' }),
    );
  });

  it('records failure when generate throws', async () => {
    const { service, runs, agent } = make(undefined);
    agent.generate = jest.fn(async () => {
      throw new Error('model down');
    });
    await expect(
      service.runChat({ id: 'u1' }, { message: 'hi' }),
    ).rejects.toThrow('model down');
    expect(runs.finish).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
