import { Optional } from '@nestjs/common';
import { confirm as promptConfirm } from '@inquirer/prompts';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import type { TransactionRecord } from './finance.helpers';

export type ConfirmPrompt = (message: string) => Promise<boolean>;

interface ReverseOptions {
  profile?: string;
  api?: string;
  yes?: boolean;
}

@SubCommand({ name: 'reverse', arguments: '<id>', description: 'Post an opposite entry that cancels a settled transaction' })
export class FinanceTxReverseCommand extends CommandRunner {
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

  async run(params: string[], options: ReverseOptions): Promise<void> {
    const [id] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const record = await client.get<TransactionRecord>(`/finance/transactions/${id}`);

    if (!options.yes) {
      if (!this.isTTY()) {
        throw new UsageError(
          `Refusing to reverse "${record.description}" without --yes in a non-interactive session.`,
        );
      }
      const confirmed = await this.confirmPrompt(
        `Reverse "${record.description}" (${record.amount})? This posts a new, opposite entry — the original is never edited.`,
      );
      if (!confirmed) {
        process.stdout.write('Aborted.\n');
        return;
      }
    }

    const reversal = await client.post<TransactionRecord>(`/finance/transactions/${id}/reverse`);
    process.stdout.write(`Posted "${reversal.description}" (${reversal.amount}, ${reversal.id}).\n`);
  }
}
