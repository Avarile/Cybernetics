import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { renderTable } from '../../core/render/table';
import type { ForecastEntry } from './finance.helpers';

interface ForecastOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  from?: string;
  to?: string;
  projectId?: string;
}

@SubCommand({ name: 'forecast', description: 'Expected income and expenses ahead' })
export class FinanceReportForecastCommand extends CommandRunner {
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

  async run(_params: string[], options: ForecastOptions): Promise<void> {
    if (options.from === undefined) throw new UsageError('--from is required.');
    if (options.to === undefined) throw new UsageError('--to is required.');

    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const query = new URLSearchParams({ from: options.from, to: options.to });
    if (options.projectId) query.set('projectId', options.projectId);

    const entries = await client.get<ForecastEntry[]>(`/finance/reports/forecast?${query.toString()}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
      return;
    }

    if (entries.length === 0) {
      process.stdout.write('Nothing forecast in this window.\n');
      return;
    }

    const table = renderTable(entries, [
      { header: 'NAME', value: (e) => e.name },
      { header: 'KIND', value: (e) => e.kind },
      // A decimal string, rendered verbatim — never parsed or reformatted.
      { header: 'AMOUNT', value: (e) => e.amount, align: 'right' },
      { header: 'DUE ON', value: (e) => e.dueOn },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
