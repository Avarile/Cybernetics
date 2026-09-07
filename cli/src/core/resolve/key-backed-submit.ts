import { ApiError, UsageError } from '../errors';
import type { KeyBackedField, VocabularyIndex } from './vocabulary';

/**
 * Resolves one buffer-side value -- a key, a list of keys, or a raw UUID
 * (`VocabularyIndex` handles all three per its own contract, Task 1) -- to
 * the id(s) a DTO field expects.
 *
 * A resolution `UsageError` (unknown key, ambiguous company name, ambiguous
 * tag scope) is fixable by editing the buffer, so it must reach
 * `EditorService`'s retry loop the same way a server-side validation issue
 * does, rather than propagating as a bare `UsageError` and killing the
 * command with the user's edits discarded. Re-wrapping it as an `ApiError`
 * whose single issue names the buffer field turns it into exactly that:
 * `annotate()` (`core/editor/issues.ts`) matches `issue.path[0]` against the
 * buffer's own field line, so the offending field gets a `# ✗ type: ...`
 * comment and the editor reopens with the user's other edits intact --
 * this is the mechanism, this module's whole reason to exist.
 *
 * Not used on the flag-only path (`--type <key>` with no editor open):
 * there is no buffer to annotate, so that path calls `VocabularyIndex`
 * directly and lets a `UsageError` propagate as itself -- ordinary exit 2,
 * no wrapping.
 */
export async function resolveKeyBackedValue(
  field: KeyBackedField,
  raw: unknown,
  vocab: VocabularyIndex,
): Promise<unknown> {
  try {
    if (field.many) {
      const values = Array.isArray(raw)
        ? raw.filter((v): v is string => typeof v === 'string' && v !== '')
        : [];
      return values.length > 0 ? await vocab.toIds(field, values) : [];
    }
    if (raw === null || raw === undefined || raw === '') return null;
    return await vocab.toId(field, String(raw));
  } catch (err) {
    if (err instanceof UsageError) {
      throw new ApiError(400, 'VALIDATION_FAILED', err.message, [
        { path: [field.bufferField], message: err.message },
      ]);
    }
    throw err;
  }
}

/**
 * Maps every key-backed field present in `dto` (i.e. the user left it
 * uncommented in a create buffer) from its buffer name to its DTO id field,
 * mutating `dto` in place: the buffer name is always deleted, and the DTO
 * name is set only when resolution produced something to send. An empty
 * scalar is omitted rather than sent as an explicit `null` -- these create
 * DTOs don't declare these fields nullable -- but an empty `many` list is
 * still sent (`tagIds: []`), since that's a meaningful value on create too.
 */
export async function mapKeyBackedFields(
  fields: KeyBackedField[],
  dto: Record<string, unknown>,
  vocab: VocabularyIndex,
): Promise<void> {
  for (const field of fields) {
    if (!(field.bufferField in dto)) continue;
    const raw = dto[field.bufferField];
    delete dto[field.bufferField];
    const resolved = await resolveKeyBackedValue(field, raw, vocab);
    if (resolved !== null) dto[field.dtoField] = resolved;
  }
}

/**
 * Looks up one entry of `KEY_BACKED_FIELDS.contact`/`.knowledge` by its
 * buffer name -- used on the flag path (`--type`, `--category`, ...), where
 * there's one flag per field rather than a whole buffer to walk. Throws
 * (rather than returning `undefined`) on a miss: `KEY_BACKED_FIELDS` is the
 * one declaration of these fields, so a caller asking for a name it doesn't
 * list is a bug in the caller, not a user mistake.
 */
export function keyBackedField(fields: KeyBackedField[], bufferField: string): KeyBackedField {
  const found = fields.find((f) => f.bufferField === bufferField);
  if (!found) {
    throw new Error(`No KeyBackedField named "${bufferField}" -- check KEY_BACKED_FIELDS.`);
  }
  return found;
}
