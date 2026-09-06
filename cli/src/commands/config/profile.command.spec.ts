import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigStore } from '../../core/config/config.store';
import { ExitCode, UsageError } from '../../core/errors';
import { ProfileAddCommand } from './profile.command';

describe('ProfileAddCommand', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;
  let config: ConfigStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-profile-'));
    env = { XDG_CONFIG_HOME: dir };
    config = new ConfigStore(env);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const configPath = () => join(dir, 'cybernetics', 'config.json');

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects "%s" as a profile name, exits 2, and writes nothing',
    async (name) => {
      const cmd = new ProfileAddCommand(config);
      let thrown: unknown;
      try {
        await cmd.run([name], { api: 'http://x' });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(UsageError);
      expect((thrown as UsageError).exitCode).toBe(ExitCode.Usage);
      expect(existsSync(configPath())).toBe(false);
    },
  );

  it('rejects a name that does not match the allowed pattern', async () => {
    const cmd = new ProfileAddCommand(config);
    await expect(cmd.run(['../evil'], { api: 'http://x' })).rejects.toBeInstanceOf(
      UsageError,
    );
    expect(existsSync(configPath())).toBe(false);
  });

  it('accepts a normal profile name and persists it', async () => {
    const cmd = new ProfileAddCommand(config);
    await cmd.run(['dev'], { api: 'http://x' });
    expect(config.read().profiles.dev).toEqual({ baseUrl: 'http://x', email: undefined });
  });
});
