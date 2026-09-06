import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

export class LockTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for ${path}. ` +
        `Another cyb process may be stuck; remove the file if you are sure it is not.`,
    );
    this.name = 'LockTimeoutError';
  }
}

export interface LockOptions {
  timeoutMs: number;
  pollMs: number;
  staleMs: number;
}

export const DEFAULT_LOCK_OPTIONS: LockOptions = {
  timeoutMs: 10_000,
  pollMs: 50,
  staleMs: 30_000,
};

interface LockRecord {
  pid: number;
  at: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A cross-process mutex built on O_EXCL file creation.
 *
 * Exists because the API rotates refresh tokens and treats a second use of a
 * spent one as theft, revoking the whole family. Two `cyb` invocations
 * refreshing at once would therefore log the user out of everything. `wx`
 * creation is atomic on every filesystem this CLI targets, which a
 * check-then-create pair is not.
 */
export class RefreshLock {
  private readonly opts: LockOptions;
  private held = false;

  constructor(
    private readonly path: string,
    opts: Partial<LockOptions> = {},
  ) {
    this.opts = { ...DEFAULT_LOCK_OPTIONS, ...opts };
  }

  async acquire(): Promise<void> {
    const deadline = Date.now() + this.opts.timeoutMs;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });

    for (;;) {
      if (this.tryCreate()) {
        this.held = true;
        return;
      }
      if (this.reapIfStale()) continue;
      if (Date.now() >= deadline) {
        throw new LockTimeoutError(this.path, this.opts.timeoutMs);
      }
      await sleep(this.opts.pollMs);
    }
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      unlinkSync(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private tryCreate(): boolean {
    let fd: number;
    try {
      // 'wx' fails if the path exists — the atomic test-and-set.
      fd = openSync(this.path, 'wx', 0o600);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
    try {
      const record: LockRecord = { pid: process.pid, at: Date.now() };
      writeSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    return true;
  }

  /** Returns true if a dead or expired lock was removed and acquisition should retry. */
  private reapIfStale(): boolean {
    let record: LockRecord;
    try {
      record = JSON.parse(readFileSync(this.path, 'utf-8')) as LockRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Released between our failed create and this read; retry immediately.
        return true;
      }
      // Unparseable content cannot identify an owner, so it can only deadlock.
      return this.remove();
    }

    const expired = Date.now() - record.at > this.opts.staleMs;
    if (expired || !isAlive(record.pid)) return this.remove();
    return false;
  }

  private remove(): boolean {
    try {
      unlinkSync(this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return true;
  }
}

function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // Signal 0 performs the permission and existence check without delivering.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means it exists but belongs to another user — still alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
