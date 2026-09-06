import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import { billToName, type InvoiceRecord } from './invoices.helpers';

interface OverdueOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'overdue', description: 'Invoices past due and not settled' })
export class InvoicesOverdueCommand extends CommandRunner {
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

  async run(_params: string[], options: OverdueOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    // Not paginated — `InvoiceService.overdue` returns every match in one call.
    const rows = await client.get<InvoiceRecord[]>('/invoices/overdue');

    if (options.json) {
      process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
      return;
    }

    if (rows.length === 0) {
      process.stdout.write('No overdue invoices.\n');
      return;
    }

    const table = renderTable(rows, [
      { header: 'NUMBER', value: (i) => i.number },
      { header: 'STATUS', value: (i) => i.status },
      { header: 'DUE', value: (i) => i.dueDate },
      // A decimal string, rendered verbatim — never parsed or reformatted.
      { header: 'TOTAL', value: (i) => i.total, align: 'right' },
      { header: 'CURRENCY', value: (i) => i.currency },
      { header: 'CONTACT', value: (i) => billToName(i.billToSnapshot) },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
