import { mastraConfig } from './mastra.config';

describe('mastraConfig', () => {
  const OLD = process.env;
  afterEach(() => {
    process.env = OLD;
  });

  it('reads defaults', () => {
    process.env = { ...OLD };
    const cfg = mastraConfig();
    expect(cfg.model).toBe('anthropic/claude-sonnet-4.6');
    expect(cfg.memoryLastMessages).toBe(20);
    expect(cfg.schedulesEnabled).toBe(false);
  });

  it('falls back to VERCEL_APIKEY, and prefers AI_GATEWAY_API_KEY when both are set', () => {
    // The alias exists because `vercel env pull` names the gateway credential
    // VERCEL_APIKEY. Precedence matters: both default to '' in the schema, so
    // the resolution must use `||` — a nullish coalesce would pass buildModel()
    // an empty string, which `loadOptionalSetting` returns verbatim instead of
    // falling through to process.env, silently disabling gateway auth.
    process.env = {
      ...OLD,
      AI_GATEWAY_API_KEY: '',
      VERCEL_APIKEY: 'vck_alias',
    };
    expect(mastraConfig().aiGatewayApiKey).toBe('vck_alias');

    process.env = {
      ...OLD,
      AI_GATEWAY_API_KEY: 'vck_primary',
      VERCEL_APIKEY: 'vck_alias',
    };
    expect(mastraConfig().aiGatewayApiKey).toBe('vck_primary');
  });

  it('reads overrides from env', () => {
    process.env = {
      ...OLD,
      MASTRA_MODEL: 'anthropic/claude-opus-4.8',
      MASTRA_SCHEDULES_ENABLED: 'true',
    };
    const cfg = mastraConfig();
    expect(cfg.model).toBe('anthropic/claude-opus-4.8');
    expect(cfg.schedulesEnabled).toBe(true);
  });
});
