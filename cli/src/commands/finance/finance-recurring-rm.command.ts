import { Optional } from '@nestjs/common';
import { confirm as promptConfirm } from '@inquirer/prompts';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';

export type ConfirmPrompt = (message: string) => Promise<boolean>;

interface RmOptions {
  profile?: string;
  api?: string;
  yes?: boolean;
}

/**
 * Unlike contacts/tasks/projects' `rm`, there is no `GET /finance/recurring/
 * {id}` (confirmed against src/generated/operations.ts — `recurringList` has
 * no by-id counterpart), so the confirmation prompt names the id rather than
 * a name fetched first.
 */
@SubCommand({ name: 'rm', arguments: '<id>', description: 'Stop a recurring schedule' })
export class FinanceRecurringRmCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
    @Optional()
    private readonly confirmPrompt: ConfirmPrompt = (message) =>
      promptConfirm({ message, default: false }),
    @Optional() private readonly isTTY: () => boolean = () => Boolean(process.stdin.isTTY),
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

  @Option({ flags: '--yes', description: 'Skip the confirmation prompt' })
  parseYes(): boolean {
    return true;
  }

  async run(params: string[], options: RmOptions): Promise<void> {
    const [id] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    if (!options.yes) {
      if (!this.isTTY()) {
        throw new UsageError(`Refusing to stop recurring schedule "${id}" without --yes in a non-interactive session.`);
      }
      const confirmed = await this.confirmPrompt(`Stop recurring schedule "${id}"?`);
      if (!confirmed) {
        process.stdout.write('Aborted.\n');
        return;
      }
    }

    await client.del(`/finance/recurring/${id}`);
    process.stdout.write(`Stopped recurring schedule "${id}".\n`);
  }
}
