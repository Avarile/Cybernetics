import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { configDir, credentialsPath } from '../config/paths';
import { UsageError } from '../errors';
import type { TokenPair } from './tokens';

type CredentialsFile = Record<string, TokenPair>;

/**
 * Persists one TokenPair per profile in a 0600 file.
 *
 * Reads assert the mode before parsing, the way ssh refuses a world-readable
 * private key: a refresh token is a bearer credential with a longer life than
 * the access token it mints, so a loosened file is a real compromise and not a
 * style violation.
 */
export class TokenStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  read(profile: string): TokenPair | null {
    const file = this.readFile();
    return file?.[profile] ?? null;
  }

  write(profile: string, pair: TokenPair): void {
    const file = this.readFile() ?? {};
    file[profile] = pair;
    this.writeFile(file);
  }

  clear(profile: string): void {
    const file = this.readFile();
    if (!file) return;
    delete file[profile];
    if (Object.keys(file).length === 0) {
      try {
        unlinkSync(credentialsPath(this.env));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      return;
    }
    this.writeFile(file);
  }

  private readFile(): CredentialsFile | null {
    const path = credentialsPath(this.env);
    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    this.assertPrivate(path);
    try {
      return JSON.parse(raw) as CredentialsFile;
    } catch {
      // UsageError for the same reason as assertPrivate below: the message
      // names the file and the fix, so this exits 2 and not 1.
      throw new UsageError(`${path} is not valid JSON. Run \`cyb login\` again.`);
    }
  }

  private writeFile(file: CredentialsFile): void {
    const path = credentialsPath(this.env);
    mkdirSync(configDir(this.env), { recursive: true, mode: 0o700 });
    const tmp = `${path}.${process.pid}.tmp`;
    // Mode is set at creation, not after: a chmod-after-write leaves a window
    // in which the tokens are on disk world-readable.
    writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, path);
  }

  private assertPrivate(path: string): void {
    // Windows does not model POSIX permission bits; the check would always fail.
    if (process.platform === 'win32') return;
    const mode = statSync(path).mode & 0o777;
    if (mode !== 0o600) {
      // UsageError, not Error: the message says exactly which command fixes
      // this, so it exits 2 rather than 1 ("something we did not expect").
      throw new UsageError(
        `${path} permissions are too open (${mode.toString(8)}). ` +
          `Run: chmod 600 ${path}`,
      );
    }
  }
}
