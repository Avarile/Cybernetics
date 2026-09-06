import {
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
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
  private ownRecord: LockRecord | null = null;

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
      // Checked on every looping path -- including a successful reap's
      // `continue` -- so sustained contention can't spin past timeoutMs
      // without ever consulting the deadline.
      if (Date.now() >= deadline) {
        throw new LockTimeoutError(this.path, this.opts.timeoutMs);
      }
      if (this.reapIfStale()) continue;
      await sleep(this.opts.pollMs);
    }
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    const record = this.ownRecord;
    this.ownRecord = null;
    // Same ownership discipline as reaping: claim whatever is at the path
    // and discard it only if it is still the exact record this instance
    // wrote. A hung operation can outlive staleMs and get legitimately
    // reaped by someone else before this call happens -- releasing must not
    // blindly unlink whatever a subsequent holder has since created there.
    this.reapRecord(record);
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
    const record: LockRecord = { pid: process.pid, at: Date.now() };
    try {
      writeSync(fd, JSON.stringify(record));
    } finally {
      closeSync(fd);
    }
    this.ownRecord = record;
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
   * Claims whatever currently sits at `this.path` and discards it only if
   * it is still the exact record `judged` names (or, when `judged` is
   * null, still equally unparseable). Otherwise nothing is deleted.
   *
   * The claim is `linkSync`, not `renameSync`: a hard link gives this call
   * a second name for the same inode without ever removing `this.path`'s
   * own directory entry. That matters because a claim that *does* empty
   * `this.path` -- even briefly -- opens a window for some other creator to
   * legitimately land a fresh lock there while we're mid-claim, and any
   * subsequent conflict-resolution step (e.g. restoring what we took) can
   * then race that creator and lose, destroying its lock with no retry and
   * no signal to it. Never emptying the path removes that window entirely:
   * there is nothing to restore, because nothing was ever taken away.
   *
   * Before the final delete, `this.path`'s inode is compared against the
   * inode we linked: if someone replaced `this.path` since (unlinked it and
   * created a new file there) the two will differ, and deleting by name
   * alone would remove that new file instead of the one we verified.
   */
  private reapRecord(judged: LockRecord | null): boolean {
    const tempPath = `${this.path}.reap.${process.pid}.${reapCounter++}`;
    try {
      linkSync(this.path, tempPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Already gone -- someone else already reaped or released it; retry.
        return true;
      }
      throw err;
    }

    try {
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

      if (!matches) return false; // Not the file we judged; delete nothing.

      let pathIno: number | bigint;
      let tempIno: number | bigint;
      try {
        pathIno = statSync(this.path).ino;
        tempIno = statSync(tempPath).ino;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
      }
      if (pathIno !== tempIno) return false; // Replaced since; delete nothing.

      try {
        unlinkSync(this.path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          // Another reaper's linkSync raced ours to the same inode, passed
          // the same checks, and already unlinked it. We did not win;
          // deleting nothing here is correct, not an error.
          return false;
        }
        throw err;
      }
      return true;
    } finally {
      try {
        unlinkSync(tempPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
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
