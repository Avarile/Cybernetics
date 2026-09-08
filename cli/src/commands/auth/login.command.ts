import { Optional } from '@nestjs/common';
import { password as promptPassword } from '@inquirer/prompts';
import { Command, CommandRunner, Option } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { SessionService } from '../../core/session/session.service';

interface LoginOptions {
  profile?: string;
  api?: string;
  email?: string;
}

export type PasswordPrompt = () => Promise<string>;
export type Writer = (s: string) => void;

@Command({ name: 'login', description: 'Authenticate and store a session' })
export class LoginCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly session: SessionService,
    // Injected so the command is testable without a TTY. @Optional() is
    // required: a function-typed param is emitted as `Function`, which Nest
    // would otherwise try — and fail — to resolve as a provider.
    @Optional()
    private readonly prompt: PasswordPrompt = () =>
      promptPassword({ message: 'Password:', mask: true }),
    @Optional()
    private readonly write: Writer = (s) => process.stdout.write(s),
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

  @Option({ flags: '-e, --email <email>', description: 'Login email' })
  parseEmail(v: string): string {
    return v;
  }

  async run(_params: string[], options: LoginOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const email = options.email ?? resolved.email;
    if (!email) {
      // UsageError, not Error: this is a flag the caller can supply, so it
      // exits 2 rather than 1 ("something we did not expect").
      throw new UsageError(
        'No email. Pass --email, or set one with: cyb config profile add',
      );
    }

    const password = await this.prompt();

    // Deliberately no retry loop: /auth/login allows 5 attempts per minute,
    // and burning that budget locks the user out for longer than re-running.
    await this.session.login(resolved.profile, resolved.baseUrl, email, password);

    this.write(`Signed in as ${email} on profile "${resolved.profile}".\n`);
  }
}
