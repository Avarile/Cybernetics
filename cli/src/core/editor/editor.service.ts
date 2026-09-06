import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configDir, recoveryPath } from '../config/paths';
import { ApiError } from '../errors';
import { DocumentParseError, parseDocument, type EditorDocument } from './frontmatter';
import { annotate } from './issues';

/** A pathological retry loop terminates rather than prompting forever. */
const MAX_ROUNDS = 5;

/** The key an unresolvable `DocumentParseError` is filed under in the header block. */
const PARSE_ERROR_KEY = '__parse_error__';

export interface EditorDeps {
  /** Injected for tests. Default spawns via `sh -c`. */
  launch?: (command: string, file: string) => Promise<number>;
  env?: NodeJS.ProcessEnv;
}

export interface EditSessionOptions {
  /** Initial buffer text (from buildTemplate). */
  initial: string;
  /** Sends the parsed document; resolve on success, reject with ApiError on failure. */
  submit: (doc: EditorDocument) => Promise<void>;
  /** Filetype hint used for the temp file extension: 'md' or 'yaml'. */
  filetype?: 'md' | 'yaml';
}

export class EditorAborted extends Error {}

/**
 * Saves `buffer` to the stable recovery path when it actually differs from
 * `initial` -- an unmodified buffer has nothing worth recovering, and saving
 * it anyway would leave a stale recovery file behind forever. Returns the
 * path written, or `undefined` when nothing was saved.
 */
export function saveRecoveryIfModified(
  buffer: string,
  initial: string,
  ext: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (buffer === initial) return undefined;
  mkdirSync(configDir(env), { recursive: true, mode: 0o700 });
  const path = recoveryPath(env, ext);
  writeFileSync(path, buffer, { mode: 0o600 });
  return path;
}

/**
 * Runs `sh -c '<editor> "$1"' sh <file>`, the way git invokes `$EDITOR`: the
 * filename is a positional argument to the inner shell rather than
 * interpolated into the command string, so an editor string carrying its own
 * flags (`EDITOR="nvim -c 'set spell'"`) still works and a filename with
 * spaces is never word-split.
 */
function defaultLaunch(command: string, file: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', `${command} "$1"`, 'sh', file], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/**
 * Drives one edit-submit-retry cycle: writes a buffer to a private temp file,
 * opens it in the user's editor, and either submits the result or re-opens
 * the buffer with the problem annotated in place.
 *
 * The temp file holds record data and is created at 0600 under `$TMPDIR`; it
 * is removed in a `finally` so it never survives the process on any path,
 * including a throw.
 */
export class EditorService {
  private readonly launch: (command: string, file: string) => Promise<number>;
  private readonly env: NodeJS.ProcessEnv;

  constructor(deps: EditorDeps = {}) {
    this.launch = deps.launch ?? defaultLaunch;
    this.env = deps.env ?? process.env;
  }

  /** `$VISUAL`, else `$EDITOR`, else `vi`. */
  resolveEditor(): string {
    return this.env.VISUAL || this.env.EDITOR || 'vi';
  }

  /** Returns when submit() succeeds. Throws EditorAborted on :cq or no-change. */
  async run(opts: EditSessionOptions): Promise<void> {
    const ext = opts.filetype ?? 'md';
    const tmpDir = this.env.TMPDIR || tmpdir();
    const file = join(tmpDir, `cyb-edit-${randomUUID()}.${ext}`);

    let buffer = opts.initial;
    let lastError: unknown;

    try {
      writeFileSync(file, buffer, { mode: 0o600 });

      try {
        for (let round = 1; ; round++) {
          if (round > MAX_ROUNDS) throw lastError;

          const editor = this.resolveEditor();
          const exitCode = await this.launch(editor, file);
          if (exitCode !== 0) throw new EditorAborted('aborted');

          const after = readFileSync(file, 'utf-8');
          if (after === buffer) throw new EditorAborted('no changes');
          buffer = after;

          let doc: EditorDocument;
          try {
            doc = parseDocument(buffer);
          } catch (err) {
            if (!(err instanceof DocumentParseError)) throw err;
            // The user's own YAML mistake must not discard their work: re-open
            // with the parse error filed under the header block, same as an
            // unmatched validation issue.
            lastError = err;
            buffer = annotate(buffer, [{ path: [PARSE_ERROR_KEY], message: err.message }]);
            writeFileSync(file, buffer);
            continue;
          }

          try {
            await opts.submit(doc);
            return;
          } catch (err) {
            if (err instanceof ApiError && err.issues.length > 0) {
              // Fixable in the buffer: re-annotate and re-open. Anything else
              // (403, 404, 409 — no issues) can't be fixed by editing, so it
              // propagates immediately instead of looping.
              lastError = err;
              buffer = annotate(buffer, err.issues);
              writeFileSync(file, buffer);
              continue;
            }
            throw err;
          }
        }
      } catch (err) {
        // EditorAborted (:cq, no changes) is the user's own choice to
        // discard -- nothing to rescue, and buffer === initial anyway in the
        // no-changes case. Every other path out of the loop above is fatal
        // and unretriable (a propagated ApiError, the MAX_ROUNDS cap, or a
        // genuinely unexpected error): exactly when the buffer, if the user
        // had modified it, is otherwise gone for good.
        if (!(err instanceof EditorAborted)) {
          const recovery = saveRecoveryIfModified(buffer, opts.initial, ext, this.env);
          if (recovery && err instanceof Error) {
            err.message += `\n\nYour edits were saved to ${recovery} -- open it to recover your work.`;
          }
        }
        throw err;
      }
    } finally {
      try {
        unlinkSync(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
  }
}
