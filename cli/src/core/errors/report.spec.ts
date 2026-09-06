import { ApiError, ExitCode, UsageError } from './index';
import { reportError } from './report';

describe('reportError', () => {
  let lines: string[];
  const write = (s: string) => {
    lines.push(s);
  };

  beforeEach(() => {
    lines = [];
  });

  it('prints the message and returns the mapped exit code', () => {
    const code = reportError(new ApiError(404, 'NOT_FOUND', 'No such contact'), write);
    expect(code).toBe(ExitCode.NotFound);
    expect(lines.join('')).toContain('No such contact');
  });

  it('lists validation issues with their field paths', () => {
    const err = new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', [
      { path: ['slug'], message: 'must be lowercase-with-dashes' },
      { path: ['tagIds', 0], message: 'Invalid uuid' },
    ]);
    reportError(err, write);
    const out = lines.join('');
    expect(out).toContain('slug: must be lowercase-with-dashes');
    expect(out).toContain('tagIds.0: Invalid uuid');
  });

  it('includes the correlation id so a server log can be found', () => {
    reportError(new ApiError(500, 'INTERNAL', 'Boom', [], 'cid-42'), write);
    expect(lines.join('')).toContain('cid-42');
  });

  it('adds a login hint when authentication is required', () => {
    reportError(new ApiError(401, 'AUTH_TOKEN_INVALID', 'Token invalid'), write);
    expect(lines.join('')).toContain('cyb login');
  });

  it('reports a plain Error as a generic failure', () => {
    expect(reportError(new Error('something broke'), write)).toBe(ExitCode.Failure);
    expect(lines.join('')).toContain('something broke');
  });

  it('reports a non-Error throw without crashing', () => {
    expect(reportError('a string', write)).toBe(ExitCode.Failure);
    expect(lines.join('')).toContain('a string');
  });

  it('reports a UsageError with its message and ExitCode.Usage', () => {
    const code = reportError(
      new UsageError('Unknown profile "nope". Add it with: cyb config profile add nope --api <url>'),
      write,
    );
    expect(code).toBe(ExitCode.Usage);
    expect(lines.join('')).toContain('Unknown profile "nope"');
  });

  it('passes through an already-reported Commander error without printing it again', () => {
    // Shape of the CommanderError nest-commander's errorHandler receives for
    // something Commander itself rejected (e.g. an unknown command) — it has
    // already written this message to the console before throwing.
    const err = { code: 'commander.unknownCommand', exitCode: 1, message: "error: unknown command 'bogus'" };
    const code = reportError(err, write);
    expect(code).toBe(ExitCode.Usage);
    expect(lines).toHaveLength(0);
  });

  it('passes through a zero-exit Commander error (--help/--version) as success', () => {
    const err = { code: 'commander.helpDisplayed', exitCode: 0, message: '(outputHelp)' };
    const code = reportError(err, write);
    expect(code).toBe(ExitCode.Ok);
    expect(lines).toHaveLength(0);
  });
});
