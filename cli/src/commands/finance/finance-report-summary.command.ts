import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import type { FinanceSummary } from './finance.helpers';

interface SummaryOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  from?: string;
  to?: string;
  projectId?: string;
}

@SubCommand({ name: 'summary', description: 'Income and expense summary' })
export class FinanceReportSummaryCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw object' })
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

  async run(_params: string[], options: SummaryOptions): Promise<void> {
    if (options.from === undefined) throw new UsageError('--from is required.');
    if (options.to === undefined) throw new UsageError('--to is required.');

    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const query = new URLSearchParams({ from: options.from, to: options.to });
    if (options.projectId) query.set('projectId', options.projectId);

    const summary = await client.get<FinanceSummary>(`/finance/reports/summary?${query.toString()}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      return;
    }

    // income/expense/net are decimal strings, printed verbatim — never
    // parsed, summed or reformatted (the API already did the summing).
    process.stdout.write(
      `${summary.from}..${summary.to}\n` +
        `  income:  ${summary.income}\n` +
        `  expense: ${summary.expense}\n` +
        `  net:     ${summary.net}\n`,
    );

    if (summary.byKind.length > 0) {
      const table = renderTable(summary.byKind, [
        { header: 'KIND', value: (k) => k.kind },
        { header: 'TOTAL', value: (k) => k.total, align: 'right' },
        { header: 'COUNT', value: (k) => String(k.count), align: 'right' },
      ]);
      process.stdout.write(`\n${table}\n`);
    }
  }
}
