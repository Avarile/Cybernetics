// `@mastra/nestjs`'s build pulls in Mastra's server/editor stack (ESM-only transitive
// deps), which breaks under Jest's default transformIgnorePatterns. `ApprovalService`
// only uses `MastraService` for its type (DI token) and calls `.getAgent(...)` on the
// injected instance, so stub the module rather than loading the real one.
jest.mock('@mastra/nestjs', () => ({ MastraService: class {} }));

import { ApprovalService } from './approval.service';

/**
 * `agent` fixture mirrors the CONFIRMED real resume API (`node_modules/@mastra/core`
 * 1.50.1, `dist/agent/agent.d.ts` L1449-1472 + `dist/docs/references/docs-agents-agent-
 * approval.md` "Tool approval with `generate()`" + stream/generate comparison table):
 * since `AgentRunnerService` resumes via `generate()` (not `stream()`), the correct bind
 * is `approveToolCallGenerate` / `declineToolCallGenerate` — the non-streaming
 * counterparts of `approveToolCall` / `declineToolCall` — see `mastra-adapters.ts` for
 * the full citation.
 */
function make(appr: any) {
  const approvals = {
    findById: jest.fn(async () => appr),
    findPendingForOwner: jest.fn(async () => [appr]),
    decide: jest.fn(async () => undefined),
  };
  const runs = { finish: jest.fn(async () => undefined) };
  const agent = {
    approveToolCallGenerate: jest.fn(async () => undefined),
    declineToolCallGenerate: jest.fn(async () => undefined),
  };
  const mastra = { getAgent: jest.fn(() => agent) };
  return {
    service: new ApprovalService(
      approvals as never,
      runs as never,
      mastra as never,
    ),
    approvals,
    runs,
    agent,
  };
}

describe('ApprovalService.decide', () => {
  const appr = {
    id: 'a1',
    runId: 'r1',
    mastraRunId: 'mr1',
    toolCallId: 'tc1',
    status: 'pending',
  };

  it('approves: resumes the tool call and marks executed', async () => {
    const { service, approvals, agent } = make(appr);
    await service.decide({ id: 'u1', role: 'admin' }, 'a1', { approved: true });
    expect(agent.approveToolCallGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'mr1', toolCallId: 'tc1' }),
    );
    expect(approvals.decide).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status: 'executed' }),
    );
  });

  it('rejects: declines and marks rejected', async () => {
    const { service, agent, approvals } = make(appr);
    await service.decide({ id: 'u1', role: 'admin' }, 'a1', {
      approved: false,
      note: 'no',
    });
    expect(agent.declineToolCallGenerate).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'mr1', toolCallId: 'tc1' }),
    );
    expect(approvals.decide).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({ status: 'rejected' }),
    );
  });

  it('409s when the approval is not pending', async () => {
    const { service } = make({ ...appr, status: 'executed' });
    await expect(
      service.decide({ id: 'u1', role: 'admin' }, 'a1', { approved: true }),
    ).rejects.toThrow();
  });
});
