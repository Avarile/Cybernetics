import { annotate } from '../editor/issues';
import { ApiError, ExitCode, parseErrorEnvelope } from './index';

const envelope = (code: string, statusCode: number, details: unknown = null) => ({
  error: {
    code,
    message: `${code} happened`,
    statusCode,
    details,
    correlationId: 'cid-1',
    timestamp: '2026-09-06T00:00:00.000Z',
    path: '/contacts',
  },
});

describe('parseErrorEnvelope', () => {
  it('reads code, message and correlationId from the envelope', () => {
    const err = parseErrorEnvelope(404, envelope('NOT_FOUND', 404));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('NOT_FOUND happened');
    expect(err.correlationId).toBe('cid-1');
  });

  it('extracts zod issues from VALIDATION_FAILED details', () => {
    const err = parseErrorEnvelope(
      400,
      envelope('VALIDATION_FAILED', 400, {
        issues: [
          { path: ['slug'], message: 'must be lowercase-with-dashes' },
          { path: ['tagIds', 0], message: 'Invalid uuid' },
        ],
      }),
    );
    expect(err.issues).toEqual([
      { path: ['slug'], message: 'must be lowercase-with-dashes' },
      { path: ['tagIds', 0], message: 'Invalid uuid' },
    ]);
  });

  it('yields an empty issue list when details carry none', () => {
    expect(parseErrorEnvelope(404, envelope('NOT_FOUND', 404)).issues).toEqual([]);
  });

  // The real API (api/src/common/pipes/zod-validation.pipe.ts and
  // api/src/infrastructure/exceptions/exception.service.ts) sends each
  // issue's `path` as a single joined STRING — `issue.path.join('.') ||
  // '(root)'` — never an array. Confirmed against the live server: a real
  // VALIDATION_FAILED response's issues were being silently dropped, because
  // this parser required `Array.isArray(path)`. That left `ApiError.issues`
  // permanently empty for every real validation error, so `EditorService`
  // treated it as unfixable and threw the user's edits away rather than
  // annotating and re-opening the buffer.
  describe('a string issue path (the real API shape)', () => {
    it('normalizes a single-segment string path to a one-element array', () => {
      const err = parseErrorEnvelope(
        400,
        envelope('VALIDATION_FAILED', 400, {
          issues: [{ path: 'slug', message: 'must be lowercase-with-dashes' }],
        }),
      );
      expect(err.issues).toEqual([{ path: ['slug'], message: 'must be lowercase-with-dashes' }]);
    });

    it('splits a dotted string path into multiple segments', () => {
      const err = parseErrorEnvelope(
        400,
        envelope('VALIDATION_FAILED', 400, {
          issues: [{ path: 'tagIds.0', message: 'Invalid uuid' }],
        }),
      );
      expect(err.issues).toEqual([{ path: ['tagIds', '0'], message: 'Invalid uuid' }]);
    });

    it('keeps an array path exactly as before (both shapes are accepted)', () => {
      const err = parseErrorEnvelope(
        400,
        envelope('VALIDATION_FAILED', 400, {
          issues: [{ path: ['tagIds', 0], message: 'Invalid uuid' }],
        }),
      );
      expect(err.issues).toEqual([{ path: ['tagIds', 0], message: 'Invalid uuid' }]);
    });

    it('drops a malformed issue (a non-string, non-array path) rather than throwing', () => {
      const err = parseErrorEnvelope(
        400,
        envelope('VALIDATION_FAILED', 400, {
          issues: [
            { path: 42, message: 'nonsense path' },
            { path: 'slug', message: 'must be lowercase-with-dashes' },
          ],
        }),
      );
      expect(err.issues).toEqual([{ path: ['slug'], message: 'must be lowercase-with-dashes' }]);
    });

    it('drops an issue with no message rather than throwing', () => {
      const err = parseErrorEnvelope(
        400,
        envelope('VALIDATION_FAILED', 400, { issues: [{ path: 'slug' }] }),
      );
      expect(err.issues).toEqual([]);
    });

    it('the "(root)" sentinel (a cross-field .refine() with no single offending key) ' +
      'survives as its own segment, so it never anchors to a real field', () => {
      const err = parseErrorEnvelope(
        400,
        envelope('VALIDATION_FAILED', 400, {
          issues: [{ path: '(root)', message: 'Provide a name or an email address' }],
        }),
      );
      expect(err.issues).toEqual([
        { path: ['(root)'], message: 'Provide a name or an email address' },
      ]);

      // Prove it end-to-end: annotate() must file it in the unmatched header
      // block, not silently vanish and not attach to an unrelated field.
      const buffer = '---\nname:\nemail:\n---\n\nbody text';
      const annotated = annotate(buffer, err.issues);
      const lines = annotated.split('\n');

      expect(lines[0]).toContain('(root)');
      expect(lines[0]).toContain('Provide a name or an email address');
      expect(lines.find((l) => l.startsWith('name:'))).toBe('name:');
      expect(lines.find((l) => l.startsWith('email:'))).toBe('email:');
    });
  });

  it('falls back to UNKNOWN when a proxy returns HTML instead of an envelope', () => {
    const err = parseErrorEnvelope(502, '<html>Bad Gateway</html>');
    expect(err.code).toBe('UNKNOWN');
    expect(err.status).toBe(502);
    expect(err.exitCode).toBe(ExitCode.Failure);
  });

  it('falls back to UNKNOWN on a null body', () => {
    expect(parseErrorEnvelope(500, null).code).toBe('UNKNOWN');
  });

  describe('exit codes', () => {
    const cases: Array<[string, number, ExitCode]> = [
      ['VALIDATION_FAILED', 400, ExitCode.Usage],
      ['UNAUTHORIZED', 401, ExitCode.AuthRequired],
      ['AUTH_TOKEN_EXPIRED', 401, ExitCode.AuthRequired],
      ['AUTH_INVALID_CREDENTIALS', 401, ExitCode.AuthRequired],
      ['FORBIDDEN', 403, ExitCode.Forbidden],
      ['NOT_FOUND', 404, ExitCode.NotFound],
      ['USER_NOT_FOUND', 404, ExitCode.NotFound],
      ['CONFLICT', 409, ExitCode.Conflict],
      ['INTERNAL', 500, ExitCode.Failure],
    ];

    it.each(cases)('maps %s to the right exit code', (code, status, expected) => {
      expect(parseErrorEnvelope(status, envelope(code, status)).exitCode).toBe(
        expected,
      );
    });

    it('maps an unrecognised code by its HTTP status', () => {
      expect(
        parseErrorEnvelope(404, envelope('SOMETHING_NEW_NOT_FOUND', 404)).exitCode,
      ).toBe(ExitCode.NotFound);
    });
  });

  describe('auth classification', () => {
    it('treats only AUTH_TOKEN_EXPIRED as refreshable', () => {
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_EXPIRED', 401)).isAuthExpiry(),
      ).toBe(true);
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_INVALID', 401)).isAuthExpiry(),
      ).toBe(false);
    });

    it('treats INVALID and REUSE as a dead session', () => {
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_INVALID', 401)).isSessionGone(),
      ).toBe(true);
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_REUSE', 401)).isSessionGone(),
      ).toBe(true);
      expect(
        parseErrorEnvelope(401, envelope('AUTH_TOKEN_EXPIRED', 401)).isSessionGone(),
      ).toBe(false);
    });
  });
});
