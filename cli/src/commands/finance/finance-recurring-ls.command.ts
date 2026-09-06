import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import type { RecurringTransactionRecord } from './finance.helpers';

interface LsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'ls', description: 'List recurring income and expenses' })
export class FinanceRecurringLsCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw array' })
  parseJson(): boolean {
    return true;
  }

  async run(_params: string[], options: LsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    // Not paginated — `RecurringService.list` returns every active schedule
    // in one call (see finance.helpers.ts's RecurringTransactionRecord doc comment).
    const rows = await client.get<RecurringTransactionRecord[]>('/finance/recurring');

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (rows.length === 0) {
      process.stdout.write('No recurring schedules.\n');
      return;
    }

    const table = renderTable(rows, [
      { header: 'NAME', value: (r) => r.name },
      { header: 'KIND', value: (r) => r.kind },
      // A decimal string, rendered verbatim — never parsed or reformatted.
      { header: 'AMOUNT', value: (r) => r.amount, align: 'right' },
      { header: 'CURRENCY', value: (r) => r.currency },
      { header: 'FREQUENCY', value: (r) => r.frequency },
      { header: 'NEXT DUE', value: (r) => r.nextDueOn ?? '' },
      { header: 'ACTIVE', value: (r) => (r.isActive ? '*' : '') },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
