import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { formatLocalDateTime } from '../../core/render/format-date';
import { renderTable } from '../../core/render/table';
import { SessionService } from '../../core/session/session.service';

/** One row of GET /auth/sessions. */
interface SessionRow {
  id: string;
  userAgent?: string | null;
  ip?: string | null;
  createdAt: string;
  expiresAt: string;
}

interface SessionsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  limit?: number;
  all?: boolean;
}

const DEFAULT_LIMIT = 20;

/** Recognised browser tokens, in the order they must be checked. Edge and
 * Chrome UAs both also contain "Safari/" (and Edge's contains "Chrome/") for
 * legacy compatibility sniffing, so the more specific product has to win. */
const BROWSER_TOKENS = ['Edg/', 'Chrome/', 'Firefox/', 'Safari/'] as const;

/**
 * Condenses a user-agent string into a short client label: the recognised
 * browser product plus its major version (`Chrome/152`), or the first
 * whitespace-delimited token for anything else (`node`, `curl/8.7.1`).
 *
 * Callers are expected to further truncate the result to fit a column width
 * (e.g. via `TableColumn.maxWidth`) — this only extracts the label.
 */
export function condenseUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (!ua) return '—';

  for (const token of BROWSER_TOKENS) {
    const tokenStart = ua.indexOf(token);
    if (tokenStart === -1) continue;

    const versionStart = tokenStart + token.length;
    const versionEnd = ua.indexOf(' ', versionStart);
    const version = versionEnd === -1 ? ua.slice(versionStart) : ua.slice(versionStart, versionEnd);
    const major = version.split('.')[0];
    const product = token.slice(0, -1); // drop the trailing '/'
    return major ? `${product}/${major}` : product;
  }

  return ua.split(/\s+/)[0];
}

/**
 * Decodes the `sid` claim (the `sessions.id` a token was minted from — see
 * `AccessTokenClaims` in api/src/features/auth/auth.types.ts) out of an
 * access token's payload segment, without verifying the signature.
 *
 * This is a display convenience only, used to mark which row in `sessions`
 * is the caller's own — never treat the result as an authenticated claim.
 * A token that doesn't decode (missing segment, bad base64url, non-JSON
 * payload, no string `sid`) resolves to `undefined` rather than throwing —
 * "unknown current session" is the correct fallback, not a command failure.
 */
export function decodeSessionId(accessToken: string): string | undefined {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload) return undefined;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      sid?: unknown;
    };
    return typeof claims.sid === 'string' ? claims.sid : undefined;
  } catch {
    return undefined;
  }
}

@Command({ name: 'sessions', description: 'List active sessions' })
export class SessionsCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
    private readonly session: SessionService,
  ) {
    super();
  }

  @Option({ flags: '-p, --profile <name>', description: 'Profile to use' })
  parseProfile(v: string): string {
    return v;
  }

  @Option({ flags: '--api <url>', description: 'Override the API base URL' })
  parseApi(v: string): string {
    return v;
  }

  @Option({ flags: '--json', description: 'Emit raw JSON' })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: '--limit <n>', description: `Max rows to show (default ${DEFAULT_LIMIT})` })
  parseLimit(v: string): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) {
      throw new UsageError(`--limit must be a positive integer, got "${v}".`);
    }
    return n;
  }

  @Option({ flags: '--all', description: 'Show all sessions, ignoring --limit' })
  parseAll(): boolean {
    return true;
  }

  async run(_params: string[], options: SessionsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const rows = await this.clients.create(resolved).get<SessionRow[]>('/auth/sessions');

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (rows.length === 0) {
      process.stdout.write('No active sessions.\n');
      return;
    }

    const currentId = await this.currentSessionId(resolved.profile, resolved.baseUrl);

    const sorted = [...rows].sort(
      (a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime(),
    );

    const limit = options.all ? sorted.length : options.limit ?? DEFAULT_LIMIT;
    const visible = sorted.slice(0, limit);
    const hidden = sorted.length - visible.length;

    const table = renderTable(visible, [
      { header: 'CURRENT', value: (row) => (row.id === currentId ? '*' : '') },
      { header: 'ID', value: (row) => row.id.slice(0, 8) },
      { header: 'IP', value: (row) => row.ip ?? '—' },
      { header: 'EXPIRES', value: (row) => formatLocalDateTime(row.expiresAt) },
      { header: 'CLIENT', value: (row) => condenseUserAgent(row.userAgent), maxWidth: 24 },
    ]);

    process.stdout.write(`${table}\n`);

    if (hidden > 0) {
      process.stdout.write(
        `\n… and ${hidden} more. Use --all to show everything, or --limit <n>.\n`,
      );
    }
  }

  /**
   * Best-effort lookup of the calling session's own id, purely to mark it in
   * the table. Never lets a decoding or token-fetch failure fail the command
   * — worst case the CURRENT column is blank for every row.
   */
  private async currentSessionId(profile: string, baseUrl: string): Promise<string | undefined> {
    try {
      const token = await this.session.getAccessToken(profile, baseUrl);
      return decodeSessionId(token);
    } catch {
      return undefined;
    }
  }
}
