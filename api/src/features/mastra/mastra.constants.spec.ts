import {
  AGENT_CATALOG,
  AGENT_IDS,
  ASSISTANT_AGENT_ID,
  DEFAULT_AGENT_ID,
  ORCHESTRATOR_AGENT_ID,
  resolveAgentId,
} from './mastra.constants';

describe('agent roster', () => {
  it('describes exactly the registered agents', () => {
    expect(AGENT_CATALOG.map((a) => a.id).sort()).toEqual(
      [...AGENT_IDS].sort(),
    );
  });

  it('defaults new conversations to the tool-less assistant', () => {
    expect(DEFAULT_AGENT_ID).toBe(ASSISTANT_AGENT_ID);
    expect(
      AGENT_CATALOG.find((a) => a.id === ASSISTANT_AGENT_ID)?.hasTools,
    ).toBe(false);
    expect(
      AGENT_CATALOG.find((a) => a.id === ORCHESTRATOR_AGENT_ID)?.hasTools,
    ).toBe(true);
  });
});

describe('resolveAgentId', () => {
  it('passes a registered id through', () => {
    expect(resolveAgentId(ORCHESTRATOR_AGENT_ID)).toBe(ORCHESTRATOR_AGENT_ID);
  });

  /**
   * `agent_conversation.agent_id` is free text, so a conversation can outlive
   * the agent it was bound to. `MastraService.getAgent` throws on an unknown id,
   * which would make such a conversation permanently unopenable — this is the
   * guard that keeps it merely reassigned.
   */
  it.each([['retired-agent'], [''], [null], [undefined]])(
    'falls back to the default for %p',
    (input) => {
      expect(resolveAgentId(input as string | null | undefined)).toBe(
        DEFAULT_AGENT_ID,
      );
    },
  );
});
