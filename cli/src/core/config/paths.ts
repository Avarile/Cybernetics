import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_DIR = 'cybernetics';

/**
 * The CLI's configuration directory.
 *
 * `env` is a parameter rather than a direct `process.env` read so tests can
 * redirect every path without mutating global state.
 */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.trim() !== '' ? xdg : join(homedir(), '.config');
  return join(base, APP_DIR);
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'config.json');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'credentials.json');
}

export function lockPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), 'refresh.lock');
}
