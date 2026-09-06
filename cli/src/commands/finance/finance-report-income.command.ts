import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import { resolveCategoryNames, type CategoryTotal } from './finance.helpers';

interface IncomeOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  from?: string;
  to?: string;
  projectId?: string;
}

@SubCommand({ name: 'income', description: 'Income by category' })
export class FinanceReportIncomeCommand extends CommandRunner {
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

  @Option({ flags: '--from <date>', description: 'YYYY-MM-DD (required)' })
  parseFrom(v: string): string {
    return v;
  }

  @Option({ flags: '--to <date>', description: 'YYYY-MM-DD (required)' })
  parseTo(v: string): string {
    return v;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Scope to one project' })
  parseProjectId(v: string): string {
    return v;
  }

  async run(_params: string[], options: IncomeOptions): Promise<void> {
    if (options.from === undefined) throw new UsageError('--from is required.');
    if (options.to === undefined) throw new UsageError('--to is required.');

    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const query = new URLSearchParams({ from: options.from, to: options.to });
    if (options.projectId) query.set('projectId', options.projectId);

    const totals = await client.get<CategoryTotal[]>(`/finance/reports/income-by-category?${query.toString()}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(totals, null, 2)}\n`);
      return;
    }

    if (totals.length === 0) {
      process.stdout.write('No income in this window.\n');
      return;
    }

    // CATEGORY: the report groups by a bare categoryId (see finance.helpers.ts's
    // CategoryTotal doc comment) — resolved the same way ACCOUNT is on tx ls,
    // rather than ever printing a raw UUID.
    const namesById = await resolveCategoryNames(client);

    const table = renderTable(totals, [
      { header: 'CATEGORY', value: (t) => (t.categoryId ? (namesById.get(t.categoryId) ?? t.categoryId) : '(uncategorized)') },
      // A decimal string, rendered verbatim — never parsed or reformatted.
      { header: 'TOTAL', value: (t) => t.total, align: 'right' },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
