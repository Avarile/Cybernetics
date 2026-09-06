import { mkdtempSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, DEFAULT_CONFIG } from './config.store';

describe('ConfigStore', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-cfg-'));
    env = { XDG_CONFIG_HOME: dir };
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the default config when no file exists', () => {
    expect(new ConfigStore(env).read()).toEqual(DEFAULT_CONFIG);
  });

  it('round-trips a written config', () => {
    const store = new ConfigStore(env);
    const cfg = {
      currentProfile: 'dev',
      profiles: { dev: { baseUrl: 'http://localhost:3000', email: 'a@b.co' } },
    };
    store.write(cfg);
    expect(store.read()).toEqual(cfg);
  });

  it('creates the config directory at 0700', () => {
    new ConfigStore(env).write(DEFAULT_CONFIG);
    const mode = statSync(join(dir, 'cybernetics')).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('writes config.json at 0644', () => {
    new ConfigStore(env).write(DEFAULT_CONFIG);
    const mode = statSync(join(dir, 'cybernetics', 'config.json')).mode & 0o777;
    expect(mode).toBe(0o644);
  });

  it('throws a readable error on malformed JSON rather than a syntax error', () => {
    const store = new ConfigStore(env);
    store.write(DEFAULT_CONFIG);
    writeFileSync(join(dir, 'cybernetics', 'config.json'), '{ not json');
    expect(() => store.read()).toThrow(/is not valid JSON/);
  });
});
