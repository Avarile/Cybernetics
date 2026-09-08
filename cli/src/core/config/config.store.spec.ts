import { mkdtempSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore, DEFAULT_CONFIG } from './config.store';
import { UsageError } from '../errors';

describe('ConfigStore', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let prevUmask: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-cfg-'));
    env = { XDG_CONFIG_HOME: dir };
    // config.json is written at 0644, but the actual mode a write ends up
    // with is that minus whatever the process umask masks off. A stricter
    // umask than the default 022 (e.g. 027, common on hardened machines)
    // would yield 0640 and fail the assertion below despite the code being
    // correct -- pin it so the test verifies our code, not the environment.
    prevUmask = process.umask(0o022);
  });

  afterEach(() => {
    process.umask(prevUmask);
    rmSync(dir, { recursive: true, force: true });
  });

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
    // Exit 2, not 1: the message names the file and the fix, so this is a
    // problem the user can act on rather than an unexpected failure.
    expect(() => store.read()).toThrow(UsageError);
  });
});
