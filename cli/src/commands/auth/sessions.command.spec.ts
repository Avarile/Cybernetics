import type { SettingsService } from '../../core/config/settings.service';
import type { ClientFactory } from '../../core/http/client.factory';
import type { SessionService } from '../../core/session/session.service';
import { SessionsCommand, condenseUserAgent, decodeSessionId } from './sessions.command';

interface Row {
  id: string;
  userAgent?: string | null;
  ip?: string | null;
  createdAt: string;
  expiresAt: string;
}

function row(id: string, expiresAt: string, extra: Partial<Row> = {}): Row {
  return { id, createdAt: '2026-01-01T00:00:00.000Z', expiresAt, ...extra };
}

function makeToken(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

describe('condenseUserAgent', () => {
  it('extracts product + major version for Chrome, ignoring the trailing Safari token', () => {
    expect(
      condenseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome/152');
  });

  it('prefers Edg over the Chrome token an Edge UA also carries', () => {
    expect(
      condenseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
      ),
    ).toBe('Edg/152');
  });

  it('extracts Firefox', () => {
    expect(
      condenseUserAgent(
        'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
      ),
    ).toBe('Firefox/130');
  });

  it('extracts Safari when no Chromium/Firefox token is present', () => {
    expect(
      condenseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      ),
    ).toBe('Safari/605');
  });

  it('passes "node" through unchanged', () => {
    expect(condenseUserAgent('node')).toBe('node');
  });

  it('passes "curl/8.7.1" through unchanged', () => {
    expect(condenseUserAgent('curl/8.7.1')).toBe('curl/8.7.1');
  });

  it('falls back to a placeholder for a missing user agent', () => {
    expect(condenseUserAgent(undefined)).toBe('—');
    expect(condenseUserAgent(null)).toBe('—');
    expect(condenseUserAgent('')).toBe('—');
  });
});

describe('decodeSessionId', () => {
  it('reads the sid claim out of a well-formed token', () => {
    expect(decodeSessionId(makeToken({ sid: 'session-123' }))).toBe('session-123');
  });

  it('returns undefined, without throwing, for a token with too few segments', () => {
    expect(() => decodeSessionId('not-a-jwt')).not.toThrow();
    expect(decodeSessionId('not-a-jwt')).toBeUndefined();
  });

  it('returns undefined, without throwing, for a payload that is not valid JSON', () => {
    const garbage = `${Buffer.from('{}').toString('base64url')}.not-base64url-json.sig`;
    expect(() => decodeSessionId(garbage)).not.toThrow();
    expect(decodeSessionId(garbage)).toBeUndefined();
  });

  it('returns undefined when the payload has no string sid', () => {
    expect(decodeSessionId(makeToken({ sub: 'user-1' }))).toBeUndefined();
    expect(decodeSessionId(makeToken({ sid: 42 }))).toBeUndefined();
  });
});

describe('SessionsCommand', () => {
  const settings = {
    resolve: () => ({ profile: 'dev', baseUrl: 'http://api.test' }),
  } as unknown as SettingsService;

  let get: jest.Mock;
  let clients: ClientFactory;
  let session: { getAccessToken: jest.Mock };
  let out: string[];
  let writeSpy: jest.SpyInstance;

  const make = () =>
    new SessionsCommand(settings, clients, session as unknown as SessionService);

  beforeEach(() => {
    get = jest.fn();
    clients = { create: () => ({ get }) } as unknown as ClientFactory;
    session = { getAccessToken: jest.fn().mockResolvedValue(makeToken({ sid: 'none' })) };
    out = [];
    writeSpy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      out.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('prints the existing empty-list message when there are no sessions', async () => {
    get.mockResolvedValue([]);
    await make().run([], {});
    expect(out.join('')).toBe('No active sessions.\n');
  });

  it('marks the row whose id matches the decoded sid as current', async () => {
    get.mockResolvedValue([
      row('aaaaaaaa-1111', '2026-09-11T11:48:00.000Z'),
      row('bbbbbbbb-2222', '2026-09-12T11:48:00.000Z'),
    ]);
    session.getAccessToken.mockResolvedValue(makeToken({ sid: 'bbbbbbbb-2222' }));

    await make().run([], {});

    const lines = out.join('').trimEnd().split('\n');
    const header = lines[0];
    const currentCol = header.indexOf('CURRENT');
    expect(currentCol).toBe(0);

    const markedLine = lines.find((l) => l.includes('bbbbbbb'));
    const unmarkedLine = lines.find((l) => l.includes('aaaaaaa'));
    expect(markedLine?.[0]).toBe('*');
    expect(unmarkedLine?.[0]).toBe(' ');
  });

  it('marks no row when the token is malformed, without throwing', async () => {
    get.mockResolvedValue([row('aaaaaaaa-1111', '2026-09-11T11:48:00.000Z')]);
    session.getAccessToken.mockResolvedValue('not-a-jwt');

    await expect(make().run([], {})).resolves.not.toThrow();

    const lines = out.join('').trimEnd().split('\n');
    expect(lines[1]?.[0]).toBe(' ');
  });

  it('marks no row (rather than failing the command) when getAccessToken itself rejects', async () => {
    get.mockResolvedValue([row('aaaaaaaa-1111', '2026-09-11T11:48:00.000Z')]);
    session.getAccessToken.mockRejectedValue(new Error('not logged in'));

    await expect(make().run([], {})).resolves.not.toThrow();
    expect(out.join('')).toContain('aaaaaaa');
  });

  it('sorts rows by expiresAt descending (newest first)', async () => {
    get.mockResolvedValue([
      row('oldest--', '2026-09-10T00:00:00.000Z'),
      row('newest--', '2026-09-13T00:00:00.000Z'),
      row('middle--', '2026-09-12T00:00:00.000Z'),
    ]);

    await make().run([], {});

    const lines = out.join('').trimEnd().split('\n').slice(1); // drop header
    expect(lines[0]).toContain('newest--');
    expect(lines[1]).toContain('middle--');
    expect(lines[2]).toContain('oldest--');
  });

  it('withholds rows past --limit and reports how many were hidden', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(`id-${i}---`, `2026-09-${10 + i}T00:00:00.000Z`),
    );
    get.mockResolvedValue(rows);

    await make().run([], { limit: 2 });

    const text = out.join('');
    const dataLines = text.trimEnd().split('\n').filter((l) => l.startsWith('*') || l.startsWith(' '));
    expect(dataLines).toHaveLength(2);
    expect(text).toContain('and 3 more');
    expect(text).toContain('--all');
  });

  it('shows every row with --all, ignoring --limit', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => {
      const day = String(((9 + i) % 28) + 1).padStart(2, '0');
      return row(`id-${i}---`, `2026-09-${day}T00:00:00.000Z`);
    });
    get.mockResolvedValue(rows);

    await make().run([], { all: true, limit: 2 });

    const text = out.join('');
    expect(text).not.toContain('more');
    const dataLines = text.trimEnd().split('\n').filter((l) => l.startsWith('*') || l.startsWith(' '));
    expect(dataLines).toHaveLength(25);
  });

  it('defaults to a limit of 20 when neither --limit nor --all is given', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, '0');
      return row(`id-${i}---`, `2026-09-${day}T00:00:00.000Z`);
    });
    get.mockResolvedValue(rows);

    await make().run([], {});

    const text = out.join('');
    expect(text).toContain('and 10 more');
  });

  it('rejects a non-positive --limit', () => {
    expect(() => make().parseLimit('0')).toThrow();
    expect(() => make().parseLimit('-5')).toThrow();
    expect(() => make().parseLimit('abc')).toThrow();
  });

  it('leaves --json output exactly as the raw API response, unsorted and untruncated', async () => {
    const rows = [
      row('bbbbbbbb-2222', '2026-09-10T00:00:00.000Z'),
      row('aaaaaaaa-1111', '2026-09-13T00:00:00.000Z'),
    ];
    get.mockResolvedValue(rows);

    await make().run([], { json: true, limit: 1 });

    expect(session.getAccessToken).not.toHaveBeenCalled();
    expect(JSON.parse(out.join(''))).toEqual(rows);
  });
});
