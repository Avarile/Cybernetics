import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { SessionService } from '../../core/session/session.service';

interface LogoutOptions {
  profile?: string;
  api?: string;
}

@Command({ name: 'logout', description: 'Revoke the stored session' })
export class LogoutCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
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

  async run(_params: string[], options: LogoutOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    await this.session.logout(resolved.profile, resolved.baseUrl);
    process.stdout.write(`Signed out of "${resolved.profile}".\n`);
  }
}
