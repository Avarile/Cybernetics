import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { renderTable } from '../../core/render/table';
import { morePagesNote, type ProjectListEnvelope } from './projects.helpers';

interface LsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

@SubCommand({ name: 'ls', description: 'List projects' })
export class ProjectsLsCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw list envelope' })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: '--search <text>', description: 'Search name and key' })
  parseSearch(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'draft|active|on_hold|completed|archived|cancelled' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--page <n>', description: 'Page number (default 1)' })
  parsePage(v: string): number {
    return positiveInt('--page', v);
  }

  @Option({ flags: '--limit <n>', description: 'Rows per page (default 20)' })
  parseLimit(v: string): number {
    return positiveInt('--limit', v);
  }

  async run(_params: string[], options: LsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const query = new URLSearchParams();
    if (options.search) query.set('search', options.search);
    if (options.status) query.set('status', options.status);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<ProjectListEnvelope>(`/projects${qs ? `?${qs}` : ''}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No projects.\n');
      return;
    }

    const table = renderTable(envelope.data, [
      { header: 'KEY', value: (r) => r.key },
      { header: 'NAME', value: (r) => r.name },
      { header: 'STATUS', value: (r) => r.status },
      { header: 'DUE', value: (r) => r.dueDate ?? '' },
    ]);
    process.stdout.write(`${table}\n`);

    const note = morePagesNote(envelope);
    if (note) process.stdout.write(`\n${note}\n`);
  }
}
