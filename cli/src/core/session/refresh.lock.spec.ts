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

  it('a reaper never removes a lock file other than the exact one it judged stale', () => {
    // Reproduces the reaper/creator race: this instance reads a stale
    // record and judges it worth reaping. Before it can act on that
    // judgment, simulate another process reaping the same stale record and
    // a third process creating a fresh, live lock in its place -- all
    // between our read and our removal step, which is exactly what a real
    // multi-process race can interleave.
    const staleRecord = { pid: 4_194_304, at: Date.now() - 60_000 };
    writeFileSync(path, JSON.stringify(staleRecord), { mode: 0o600 });

    const lock = new RefreshLock(path);

    unlinkSync(path);
    const liveRecord = { pid: process.pid, at: Date.now() };
    writeFileSync(path, JSON.stringify(liveRecord), { mode: 0o600 });

    // Act on the (now stale, superseded) judgment directly -- this is what
    // reapIfStale would have called had it read staleRecord a moment ago.
    const reaped = (
      lock as unknown as {
        reapRecord(judged: { pid: number; at: number } | null): boolean;
      }
    ).reapRecord(staleRecord);

    expect(reaped).toBe(false);
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
});
