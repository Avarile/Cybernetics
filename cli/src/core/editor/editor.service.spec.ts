import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoveryPath } from '../config/paths';
import { ApiError, type ApiIssue } from '../errors';
import { EditorAborted, EditorService, saveRecoveryIfModified } from './editor.service';

const VALID = ['---', 'title: Hello', '---', '', 'Body.'].join('\n');
const INITIAL = ['---', 'title: ""', '---', '', ''].join('\n');

/**
 * Stubs `launch` as a sequence of "the editor produced this content and
 * exited with this code" steps, one per invocation (the last step repeats if
 * `run()` calls it more times than scripted). Each step's write is preceded
 * by capturing what was on disk when the editor "opened" it, so a test can
 * assert on what a re-annotated buffer looked like going into the next round.
 */
function scripted(steps: Array<{ write: string; exitCode?: number }>) {
  const reads: string[] = [];
  const files: string[] = [];
  let calls = 0;

  const launch = async (_command: string, file: string): Promise<number> => {
    calls++;
    files.push(file);
    reads.push(readFileSync(file, 'utf-8'));
    const step = steps[Math.min(calls - 1, steps.length - 1)];
    writeFileSync(file, step.write);
    return step.exitCode ?? 0;
  };

  return { launch, reads, files, callCount: () => calls };
}

describe('EditorService.resolveEditor', () => {
  it('prefers VISUAL over EDITOR over the vi fallback', () => {
    expect(new EditorService({ env: { VISUAL: 'nvim', EDITOR: 'nano' } }).resolveEditor()).toBe(
      'nvim',
    );
    expect(new EditorService({ env: { EDITOR: 'nano' } }).resolveEditor()).toBe('nano');
    expect(new EditorService({ env: {} }).resolveEditor()).toBe('vi');
  });
});

describe('EditorService.run', () => {
  it('submits the parsed document on the happy path', async () => {
    const { launch } = scripted([{ write: VALID }]);
    const submit = jest.fn().mockResolvedValue(undefined);

    await new EditorService({ launch }).run({ initial: INITIAL, submit });

    expect(submit).toHaveBeenCalledWith({ fields: { title: 'Hello' }, body: 'Body.' });
  });

  it('creates the temp file at mode 0600', async () => {
    let mode = -1;
    const launch = async (_command: string, file: string) => {
      mode = statSync(file).mode & 0o777;
      writeFileSync(file, VALID);
      return 0;
    };
    const submit = jest.fn().mockResolvedValue(undefined);

    await new EditorService({ launch }).run({ initial: INITIAL, submit });

    expect(mode).toBe(0o600);
  });

  it('removes the temp file even when the flow throws', async () => {
    let capturedFile = '';
    const launch = async (_command: string, file: string) => {
      capturedFile = file;
      return 1; // :cq
    };
    const submit = jest.fn();

    await expect(new EditorService({ launch }).run({ initial: INITIAL, submit })).rejects.toThrow(
      EditorAborted,
    );

    expect(capturedFile).not.toBe('');
    expect(existsSync(capturedFile)).toBe(false);
  });

  it('removes the temp file on the happy path too', async () => {
    let capturedFile = '';
    const launch = async (_command: string, file: string) => {
      capturedFile = file;
      writeFileSync(file, VALID);
      return 0;
    };
    const submit = jest.fn().mockResolvedValue(undefined);

    await new EditorService({ launch }).run({ initial: INITIAL, submit });

    expect(existsSync(capturedFile)).toBe(false);
  });

  it('throws EditorAborted("aborted") on a non-zero editor exit, without submitting', async () => {
    const launch = async () => 1;
    const submit = jest.fn();

    await expect(new EditorService({ launch }).run({ initial: INITIAL, submit })).rejects.toThrow(
      /aborted/,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('throws EditorAborted("no changes") when the buffer comes back untouched', async () => {
    const launch = async () => 0; // never writes; file stays as `initial`
    const submit = jest.fn();

    await expect(new EditorService({ launch }).run({ initial: INITIAL, submit })).rejects.toThrow(
      /no changes/,
    );
    expect(submit).not.toHaveBeenCalled();
  });

  it('re-annotates and re-opens on an ApiError carrying issues, then succeeds on round two', async () => {
    const issues: ApiIssue[] = [{ path: ['title'], message: 'too short' }];
    const submit = jest
      .fn()
      .mockRejectedValueOnce(new ApiError(422, 'VALIDATION_FAILED', 'bad', issues))
      .mockResolvedValueOnce(undefined);

    const round1 = ['---', 'title: Hi', '---', '', ''].join('\n');
    const round2 = ['---', 'title: Hello', '---', '', ''].join('\n');
    const { launch, reads } = scripted([{ write: round1 }, { write: round2 }]);

    await new EditorService({ launch }).run({ initial: INITIAL, submit });

    expect(submit).toHaveBeenCalledTimes(2);
    // The second round's editor invocation must have seen round one's
    // annotation, not a blank re-throw of the same buffer.
    expect(reads[1]).toContain('# ✗ title: too short');
  });

  it('propagates an ApiError with no issues immediately, without retrying', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cyb-cfg-'));
    const env = { XDG_CONFIG_HOME: dir };
    try {
      const apiError = new ApiError(409, 'CONFLICT', 'stale');
      const submit = jest.fn().mockRejectedValue(apiError);
      const { launch } = scripted([{ write: VALID }]);

      await expect(
        new EditorService({ launch, env }).run({ initial: INITIAL, submit }),
      ).rejects.toBe(apiError);
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('re-opens with the parse error as a header annotation on bad YAML, preserving the buffer', async () => {
    const broken = 'not a frontmatter document at all';
    const fixed = ['---', 'title: Hello', '---', '', ''].join('\n');
    const submit = jest.fn().mockResolvedValue(undefined);
    const { launch, reads } = scripted([{ write: broken }, { write: fixed }]);

    await new EditorService({ launch }).run({ initial: INITIAL, submit });

    expect(submit).toHaveBeenCalledTimes(1);
    // Round two's buffer carries the parse error as a comment, not a
    // discarded-and-replaced document.
    expect(reads[1]).toContain("expected '---'");
  });

  it('caps at 5 rounds; the sixth throws the last error without opening the editor again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cyb-cfg-'));
    const env = { XDG_CONFIG_HOME: dir };
    try {
      const issues: ApiIssue[] = [{ path: ['title'], message: 'still bad' }];
      const errors: ApiError[] = [];
      const submit = jest.fn().mockImplementation(async () => {
        const err = new ApiError(422, 'VALIDATION_FAILED', `attempt ${errors.length + 1}`, issues);
        errors.push(err);
        throw err;
      });

      let launchCalls = 0;
      const launch = async (_command: string, file: string) => {
        launchCalls++;
        // Content must change each round or the "no changes" abort would fire
        // before the round is even attempted.
        writeFileSync(file, `${VALID}\n<!-- round ${launchCalls} -->`);
        return 0;
      };

      // `errors` fills in as the promise runs, so its final length can only be
      // read after the promise has settled — not passed as a same-tick arg to
      // `.rejects.toBe()`, which would see it still empty.
      const promise = new EditorService({ launch, env }).run({ initial: INITIAL, submit });
      await expect(promise).rejects.toBeInstanceOf(ApiError);
      const rejection = await promise.catch((err) => err);

      expect(errors).toHaveLength(5);
      expect(rejection).toBe(errors[4]);
      expect(launchCalls).toBe(5);
      expect(submit).toHaveBeenCalledTimes(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('EditorService.run recovery on fatal paths', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-cfg-'));
    env = { XDG_CONFIG_HOME: dir };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('saves the modified buffer and names the recovery path in a fatal ApiError', async () => {
    const apiError = new ApiError(409, 'CONFLICT', 'stale');
    const submit = jest.fn().mockRejectedValue(apiError);
    const { launch } = scripted([{ write: VALID }]);

    const rejection: ApiError = await new EditorService({ launch, env })
      .run({ initial: INITIAL, submit })
      .catch((err) => err);

    expect(rejection).toBe(apiError);
    const path = recoveryPath(env, 'md');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf-8')).toBe(VALID);
    expect(rejection.message).toContain(path);
  });

  it('saves the buffer and names the recovery path when the round cap is hit', async () => {
    const issues: ApiIssue[] = [{ path: ['title'], message: 'still bad' }];
    const submit = jest.fn().mockImplementation(async () => {
      throw new ApiError(422, 'VALIDATION_FAILED', 'bad', issues);
    });
    let launchCalls = 0;
    const launch = async (_command: string, file: string) => {
      launchCalls++;
      writeFileSync(file, `${VALID}\n<!-- round ${launchCalls} -->`);
      return 0;
    };

    const rejection: ApiError = await new EditorService({ launch, env })
      .run({ initial: INITIAL, submit })
      .catch((err) => err);

    const path = recoveryPath(env, 'md');
    expect(existsSync(path)).toBe(true);
    expect(rejection.message).toContain(path);
  });

  it('leaves no recovery file behind on :cq', async () => {
    const launch = async () => 1;
    const submit = jest.fn();

    await new EditorService({ launch, env }).run({ initial: INITIAL, submit }).catch(() => {});

    expect(existsSync(recoveryPath(env, 'md'))).toBe(false);
  });

  it('leaves no recovery file behind on a no-change abort', async () => {
    const launch = async () => 0; // never writes; buffer stays === initial
    const submit = jest.fn();

    await new EditorService({ launch, env }).run({ initial: INITIAL, submit }).catch(() => {});

    expect(existsSync(recoveryPath(env, 'md'))).toBe(false);
  });
});

describe('saveRecoveryIfModified', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cyb-cfg-'));
    env = { XDG_CONFIG_HOME: dir };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the buffer and returns the path when it differs from initial', () => {
    const path = saveRecoveryIfModified('changed', 'initial', 'md', env);
    expect(path).toBe(recoveryPath(env, 'md'));
    expect(readFileSync(path!, 'utf-8')).toBe('changed');
  });

  it('does nothing for an unmodified buffer', () => {
    const path = saveRecoveryIfModified('same', 'same', 'md', env);
    expect(path).toBeUndefined();
    expect(existsSync(recoveryPath(env, 'md'))).toBe(false);
  });
});
