import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import type { TransactionRecord } from './finance.helpers';

interface StatusOptions {
  profile?: string;
  api?: string;
}

/**
 * `status` is a path param on the API side (`/finance/transactions/:id/
 * status/:status`, validated server-side against `TRANSACTION_STATUSES` via
 * `ParseEnumPipe` — see finance.controller.ts), not a body — there is
 * nothing to build a DTO or open an editor for here.
 */
@SubCommand({ name: 'status', arguments: '<id> <status>', description: 'Clear, reconcile or void a transaction' })
export class FinanceTxStatusCommand extends CommandRunner {
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

  async run(params: string[], options: StatusOptions): Promise<void> {
    const [id, status] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const updated = await client.post<TransactionRecord>(`/finance/transactions/${id}/status/${status}`);
    process.stdout.write(`"${updated.description}" is now ${updated.status}.\n`);
  }
}
