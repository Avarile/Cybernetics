import { ASSISTANT_INSTRUCTIONS, ORCHESTRATOR_INSTRUCTIONS } from './prompts';

/**
 * Prompt-level contracts only.
 *
 * Neither agent factory is unit-tested: `@mastra/core/agent` reaches
 * `@sindresorhus/slugify`, which is ESM-only and cannot be loaded by this repo's
 * CJS Jest transform (the hazard `mastra-adapters.ts` documents, and why
 * `orchestrator.agent.ts` has no spec either). `prompts.ts` has no imports at
 * all, so the behavioural rules that actually distinguish the two agents are
 * reachable here. Tool wiring is covered live — see the plan's verification.
 */
describe('ASSISTANT_INSTRUCTIONS', () => {
  /**
   * The load-bearing clause. A tool-less model asked about the user's records
   * has no way to look and every incentive to answer anyway; without an explicit
   * "you have no access" rule it invents data — the mirror image of the
   * fabrication risk `orchestrator.agent.ts` documents for its unregistered
   * stub tools.
   */
  it('states it has no tools and no data access', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/NO tools and NO access/);
  });

  it('forbids inventing data or implying a lookup', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/NEVER invent their data/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/never imply you looked/i);
  });

  /**
   * Regression guard. Asked "what are my open tasks?", the model answered "You
   * have no open tasks recorded." — a fabricated fact stated with confidence.
   * The earlier "never invent data" rule did not cover it, because a confident
   * negative does not read as invention to the model. Absence needs naming.
   */
  it('forbids claiming absence, not just claiming data', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/includes ABSENCE/);
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/never that there is none/);
  });

  /** A refusal is only useful if it names the way forward. */
  it('routes data requests to the Operations agent', () => {
    expect(ASSISTANT_INSTRUCTIONS).toMatch(/Operations agent/);
  });

  /** It must not inherit the orchestrator's "search before answering" rule. */
  it('does not demand a tool call before answering', () => {
    expect(ASSISTANT_INSTRUCTIONS).not.toMatch(/ALWAYS gather facts/);
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/ALWAYS gather facts/);
  });
});
