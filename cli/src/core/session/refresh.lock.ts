import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
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

// Shared by every RefreshLock instance in this process, so two reap attempts
// racing in the same process (e.g. two instances in one test file, both
// sharing process.pid) can never pick the same temp filename.
let reapCounter = 0;

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
      return this.reapRecord(null);
    }

    const expired = Date.now() - record.at > this.opts.staleMs;
    if (expired || !isAlive(record.pid)) return this.reapRecord(record);
    return false;
  }

  /**
   * Atomically claims whatever currently sits at `this.path` and discards it
   * only if it is still the exact record `judged` names (or, when `judged`
   * is null, still equally unparseable). If the file has changed underneath
   * us -- another reaper won the race for the record we judged, and a fresh,
   * live lock has since been created in its place -- the claimed file is
   * restored rather than deleted, and this reports that we did not win.
   *
   * The claim (`renameSync`) is atomic: at most one racing reaper's rename
   * can succeed against a given source path. Every other racer's rename
   * fails with ENOENT because the source is already gone, so a losing
   * reaper never acts on a file it didn't itself just remove from
   * `this.path` -- it only ever retries. This is what keeps two reapers that
   * both judged the same stale record from one of them deleting whatever a
   * third process created in the path's place.
   */
  private reapRecord(judged: LockRecord | null): boolean {
    const tempPath = `${this.path}.reap.${process.pid}.${reapCounter++}`;
    try {
      renameSync(this.path, tempPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Someone else already reaped or released it first; retry.
        return true;
      }
      throw err;
    }

    let claimed: LockRecord | null;
    try {
      claimed = JSON.parse(readFileSync(tempPath, 'utf-8')) as LockRecord;
    } catch {
      claimed = null;
    }

    const matches =
      judged === null
        ? claimed === null
        : claimed !== null && claimed.pid === judged.pid && claimed.at === judged.at;

    if (matches) {
      unlinkSync(tempPath);
      return true;
    }

    // Not the file we judged -- someone else's fresh lock landed here
    // between our read and our claim. Put it back. `linkSync` fails loudly
    // (EEXIST) instead of silently clobbering, in case a third process has
    // since taken the path too.
    try {
      linkSync(tempPath, this.path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    } finally {
      unlinkSync(tempPath);
    }
    return false;
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
