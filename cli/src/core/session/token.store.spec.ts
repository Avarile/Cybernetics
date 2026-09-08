import { chmodSync, mkdtempSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenStore } from './token.store';
import { UsageError } from '../errors';

const PAIR = { accessToken: 'a', refreshToken: 'r', expiresAt: 123 };

describe('TokenStore', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let credFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-tok-'));
    env = { XDG_CONFIG_HOME: dir };
    credFile = join(dir, 'cybernetics', 'credentials.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns null when no credentials file exists', () => {
    expect(new TokenStore(env).read('dev')).toBeNull();
  });

  it('round-trips a pair for a profile', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    expect(store.read('dev')).toEqual(PAIR);
  });

  it('keeps profiles isolated', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    store.write('prod', { ...PAIR, accessToken: 'other' });
    expect(store.read('dev')?.accessToken).toBe('a');
    expect(store.read('prod')?.accessToken).toBe('other');
  });

  it('returns null for a profile that has no entry', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    expect(store.read('prod')).toBeNull();
  });

  it('writes credentials.json at 0600', () => {
    new TokenStore(env).write('dev', PAIR);
    expect(statSync(credFile).mode & 0o777).toBe(0o600);
  });

  it('refuses to read credentials that are group- or world-readable', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    chmodSync(credFile, 0o644);
    expect(() => store.read('dev')).toThrow(/permissions are too open/);
    // Exit 2, not 1: a deliberate, well-handled guard whose message names
    // the exact command that fixes it.
    expect(() => store.read('dev')).toThrow(UsageError);
  });

  it('reports malformed credentials as a usage error', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    writeFileSync(credFile, '{ not json', { mode: 0o600 });
    expect(() => store.read('dev')).toThrow(/is not valid JSON/);
    expect(() => store.read('dev')).toThrow(UsageError);
  });

  it('clear removes only the named profile', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    store.write('prod', PAIR);
    store.clear('dev');
    expect(store.read('dev')).toBeNull();
    expect(store.read('prod')).toEqual(PAIR);
  });

  it('clear on a missing file is a no-op rather than an error', () => {
    expect(() => new TokenStore(env).clear('dev')).not.toThrow();
  });

  it('never leaves a temp file behind', () => {
    const store = new TokenStore(env);
    store.write('dev', PAIR);
    const entries = readFileSync(credFile, 'utf-8');
    expect(entries).toContain('accessToken');
    expect(
      require('node:fs').readdirSync(join(dir, 'cybernetics')),
    ).toEqual(['credentials.json']);
  });
});
