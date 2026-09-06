import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LockTimeoutError, RefreshLock } from './refresh.lock';

describe('RefreshLock', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-lock-'));
    path = join(dir, 'refresh.lock');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('acquires an uncontended lock and creates the file', async () => {
    const lock = new RefreshLock(path);
    await lock.acquire();
    expect(existsSync(path)).toBe(true);
    lock.release();
    expect(existsSync(path)).toBe(false);
  });

  it('blocks a second holder until the first releases', async () => {
    const a = new RefreshLock(path);
    const b = new RefreshLock(path, { pollMs: 5 });
    await a.acquire();

    let acquired = false;
    const pending = b.acquire().then(() => {
      acquired = true;
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(acquired).toBe(false);

    a.release();
    await pending;
    expect(acquired).toBe(true);
    b.release();
  });

  it('times out rather than waiting forever', async () => {
    const a = new RefreshLock(path);
    const b = new RefreshLock(path, { timeoutMs: 60, pollMs: 5 });
    await a.acquire();
    await expect(b.acquire()).rejects.toBeInstanceOf(LockTimeoutError);
    a.release();
  });

  it('reaps a lock held by a pid that is no longer alive', async () => {
    // pid 2^22 is above the default pid_max on Linux and macOS, so it cannot
    // be a live process.
    writeFileSync(
      path,
      JSON.stringify({ pid: 4_194_304, at: Date.now() }),
      { mode: 0o600 },
    );
    const lock = new RefreshLock(path, { timeoutMs: 200, pollMs: 5 });
    await lock.acquire();
    lock.release();
  });

  it('reaps a lock older than staleMs even if the pid is alive', async () => {
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, at: Date.now() - 60_000 }),
      { mode: 0o600 },
    );
    const lock = new RefreshLock(path, { timeoutMs: 200, pollMs: 5, staleMs: 1_000 });
    await lock.acquire();
    lock.release();
  });

  it('reaps a corrupt lock file rather than deadlocking on it', async () => {
    writeFileSync(path, 'not json', { mode: 0o600 });
    const lock = new RefreshLock(path, { timeoutMs: 200, pollMs: 5 });
    await lock.acquire();
    lock.release();
  });

  it('release is idempotent', async () => {
    const lock = new RefreshLock(path);
    await lock.acquire();
    lock.release();
    expect(() => lock.release()).not.toThrow();
  });

  it('withLock releases even when the body throws', async () => {
    const lock = new RefreshLock(path);
    await expect(
      lock.withLock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(existsSync(path)).toBe(false);
  });

  it('a reap attempt never deletes a lock file other than the exact one it judged stale', async () => {
    // Reproduces the reaper/creator race entirely through the public
    // acquire() surface: this instance's own read (inside acquire()) sees a
    // stale record and judges it worth reaping. Immediately after that
    // read -- simulated via an isolated fs mock, since the real window is a
    // single synchronous call with no `await` gap a second real process
    // could be interleaved through -- another process reaps the same stale
    // record and a fresh, live lock lands in its place before this
    // instance can act on its judgment.
    const staleRecord = { pid: 4_194_304, at: Date.now() - 60_000 };
    writeFileSync(path, JSON.stringify(staleRecord), { mode: 0o600 });

    const liveRecord = { pid: process.pid, at: Date.now() };
    let swapped = false;
    let IsolatedRefreshLock!: typeof RefreshLock;
    let IsolatedLockTimeoutError!: typeof LockTimeoutError;

    jest.isolateModules(() => {
      jest.doMock('node:fs', () => {
        const actual = jest.requireActual('node:fs');
        return {
          ...actual,
          readFileSync: (...args: unknown[]) => {
            const [p] = args;
            const result = actual.readFileSync(...(args as [string, string]));
            if (p === path && !swapped) {
              swapped = true;
              actual.unlinkSync(path);
              actual.writeFileSync(path, JSON.stringify(liveRecord), {
                mode: 0o600,
              });
            }
            return result;
          },
        };
      });
      const mod = require('./refresh.lock');
      IsolatedRefreshLock = mod.RefreshLock;
      IsolatedLockTimeoutError = mod.LockTimeoutError;
    });

    const lock = new IsolatedRefreshLock(path, { timeoutMs: 200, pollMs: 5 });
    // liveRecord is genuinely alive and fresh, so this instance can never
    // legitimately win the lock -- the point is what survives, not whether
    // it acquires.
    await expect(lock.acquire()).rejects.toBeInstanceOf(IsolatedLockTimeoutError);

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(liveRecord);
  });

  it('a reap attempt never leaves the shared lock path observably empty, even if a third process claims it mid-reap', async () => {
    // The critical case round 1's mismatch check alone doesn't cover: if
    // the claim step itself empties the shared path while reconciling a
    // mismatch, a third process can legitimately claim that gap, and
    // whatever this instance does next must not destroy that third
    // process's lock. The only robust fix is for the claim to never empty
    // the path in the first place; this test asserts that invariant
    // directly, plus the concrete data-loss outcome if it's ever violated.
    const staleRecord = { pid: 4_194_304, at: Date.now() - 60_000 };
    writeFileSync(path, JSON.stringify(staleRecord), { mode: 0o600 });

    const liveRecord = { pid: process.pid, at: Date.now() };
    const thirdRecord = { pid: process.pid, at: Date.now() + 1 };
    let swapped = false;
    let sawPathMissing = false;
    let IsolatedRefreshLock!: typeof RefreshLock;
    let IsolatedLockTimeoutError!: typeof LockTimeoutError;

    jest.isolateModules(() => {
      jest.doMock('node:fs', () => {
        const actual = jest.requireActual('node:fs');
        return {
          ...actual,
          readFileSync: (...args: unknown[]) => {
            const [p] = args;
            const result = actual.readFileSync(...(args as [string, string]));
            if (p === path && !swapped) {
              // Another reaper beats us to reaping the stale record and a
              // fresh, live lock lands in its place before we act.
              swapped = true;
              actual.unlinkSync(path);
              actual.writeFileSync(path, JSON.stringify(liveRecord), {
                mode: 0o600,
              });
            } else if (p !== path && !actual.existsSync(path)) {
              // We're examining what we just claimed, and the shared path
              // is observably empty right now -- only possible if our own
              // claim step emptied it. Simulate a second process claiming
              // it before we can act.
              sawPathMissing = true;
              actual.writeFileSync(path, JSON.stringify(thirdRecord), {
                mode: 0o600,
              });
            }
            return result;
          },
        };
      });
      const mod = require('./refresh.lock');
      IsolatedRefreshLock = mod.RefreshLock;
      IsolatedLockTimeoutError = mod.LockTimeoutError;
    });

    const lock = new IsolatedRefreshLock(path, { timeoutMs: 200, pollMs: 5 });
    await expect(lock.acquire()).rejects.toBeInstanceOf(IsolatedLockTimeoutError);

    expect(sawPathMissing).toBe(false);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(liveRecord);
  });

  it('release() never deletes a lock file other than the one this instance created', async () => {
    // Reproduces the other end of the same class of bug: a holds the lock,
    // its work hangs past staleMs, another process reaps a's now-stale
    // lock and acquires its own fresh, live one in its place -- all
    // without a's knowledge -- and only then does a's hung work finish and
    // call release().
    const a = new RefreshLock(path);
    await a.acquire();

    unlinkSync(path);
    const otherRecord = { pid: process.pid + 1, at: Date.now() };
    writeFileSync(path, JSON.stringify(otherRecord), { mode: 0o600 });

    a.release();

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(otherRecord);
  });

  it('a reaper that loses the final unlink race to another reaper retries instead of throwing', async () => {
    // Two reapers can each `linkSync` their own temp name to the same
    // inode, both pass the record-match and inode-identity checks, and
    // both then call `unlinkSync(this.path)`. Only one can win; the loser
    // must see ENOENT and return false, not crash `acquire()`. Nothing
    // here actually spawns a second process -- the mock makes the *first*
    // unlink attempt behave as if some other reaper had already won,
    // without truly removing the file, so the very next iteration reaps
    // it for real and the lock is still acquired in the end.
    writeFileSync(
      path,
      JSON.stringify({ pid: 4_194_304, at: Date.now() }),
      { mode: 0o600 },
    );

    let racedOnce = false;
    let sawEnoentFromPathUnlink = false;
    let IsolatedRefreshLock!: typeof RefreshLock;

    jest.isolateModules(() => {
      jest.doMock('node:fs', () => {
        const actual = jest.requireActual('node:fs');
        return {
          ...actual,
          unlinkSync: (p: string) => {
            if (p === path && !racedOnce) {
              racedOnce = true;
              sawEnoentFromPathUnlink = true;
              const err: NodeJS.ErrnoException = new Error('ENOENT (simulated race)');
              err.code = 'ENOENT';
              throw err;
            }
            return actual.unlinkSync(p);
          },
        };
      });
      const mod = require('./refresh.lock');
      IsolatedRefreshLock = mod.RefreshLock;
    });

    const lock = new IsolatedRefreshLock(path, { timeoutMs: 500, pollMs: 5 });
    await expect(lock.acquire()).resolves.toBeUndefined();

    expect(sawEnoentFromPathUnlink).toBe(true);
    expect(existsSync(path)).toBe(true); // the lock this instance itself just created
    lock.release();
  });

  it('acquire() still bounds the wait under sustained reap-retry churn', async () => {
    // Forces reapIfStale() to return true on every single iteration (as if
    // the lock were being endlessly reaped-and-recreated by other
    // processes faster than we can win it), which takes the loop's
    // `continue` branch every time. The deadline must still be honoured on
    // every one of those iterations, not just the ones that fall through
    // to the sleep.
    writeFileSync(
      path,
      JSON.stringify({ pid: 4_194_304, at: Date.now() }),
      { mode: 0o600 },
    );

    let IsolatedRefreshLock!: typeof RefreshLock;
    let IsolatedLockTimeoutError!: typeof LockTimeoutError;
    jest.isolateModules(() => {
      jest.doMock('node:fs', () => {
        const actual = jest.requireActual('node:fs');
        return {
          ...actual,
          linkSync: () => {
            const err: NodeJS.ErrnoException = new Error('ENOENT (simulated)');
            err.code = 'ENOENT';
            throw err;
          },
        };
      });
      const mod = require('./refresh.lock');
      IsolatedRefreshLock = mod.RefreshLock;
      IsolatedLockTimeoutError = mod.LockTimeoutError;
    });

    const lock = new IsolatedRefreshLock(path, { timeoutMs: 100, pollMs: 5 });
    const start = Date.now();
    await expect(lock.acquire()).rejects.toBeInstanceOf(IsolatedLockTimeoutError);
    expect(Date.now() - start).toBeLessThan(1_000);
  }, 3_000);
});
