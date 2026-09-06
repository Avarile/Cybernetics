import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';

/** Shape of GET /auth/me — mirrors `UserProfile` in api/src/features/auth/auth.types.ts. */
interface UserProfile {
  id: string | null;
  kind: string;
  role?: string;
  email?: string;
  displayName?: string | null;
}

interface WhoamiOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@Command({ name: 'whoami', description: 'Show the authenticated principal' })
export class WhoamiCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
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

  async run(_params: string[], options: WhoamiOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const me = await client.get<UserProfile>('/auth/me');

    if (options.json) {
      process.stdout.write(`${JSON.stringify(me, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      [
        `profile  ${resolved.profile}`,
        `api      ${resolved.baseUrl}`,
        `id       ${me.id ?? '—'}`,
        `kind     ${me.kind}`,
        `role     ${me.role ?? '—'}`,
        `email    ${me.email ?? '—'}`,
        `name     ${me.displayName ?? '—'}`,
      ].join('\n') + '\n',
    );
  }
}
