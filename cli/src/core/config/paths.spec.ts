import { homedir } from 'node:os';
import { join } from 'node:path';
import { configDir, configPath, credentialsPath, lockPath, recoveryPath } from './paths';

describe('config paths', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    expect(configDir({ XDG_CONFIG_HOME: '/tmp/xdg' })).toBe('/tmp/xdg/cybernetics');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    expect(configDir({})).toBe(join(homedir(), '.config', 'cybernetics'));
  });

  it('treats an empty XDG_CONFIG_HOME as unset', () => {
    // An exported-but-empty variable is common in shell profiles and would
    // otherwise resolve every path to "/cybernetics".
    expect(configDir({ XDG_CONFIG_HOME: '   ' })).toBe(
      join(homedir(), '.config', 'cybernetics'),
    );
  });

  it('derives the three file paths from the directory', () => {
    const env = { XDG_CONFIG_HOME: '/tmp/xdg' };
    expect(configPath(env)).toBe('/tmp/xdg/cybernetics/config.json');
    expect(credentialsPath(env)).toBe('/tmp/xdg/cybernetics/credentials.json');
    expect(lockPath(env)).toBe('/tmp/xdg/cybernetics/refresh.lock');
  });

  it('names a stable recovery file per filetype, defaulting to md', () => {
    const env = { XDG_CONFIG_HOME: '/tmp/xdg' };
    expect(recoveryPath(env)).toBe('/tmp/xdg/cybernetics/recovery.md');
    expect(recoveryPath(env, 'yaml')).toBe('/tmp/xdg/cybernetics/recovery.yaml');
  });
});
