import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { AddressResolver, projectByKey, taskByProjectAndNumber } from '../../core/resolve/resolver';
import { renderTable } from '../../core/render/table';
import { morePagesNote } from './tasks.helpers';
import type { TimeEntryRecord } from './tasks-time-log.command';

interface TimeLsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  project?: string;
  task?: string;
  userId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/** `GET /tasks/time` response envelope. */
export interface TimeEntryListEnvelope {
  data: TimeEntryRecord[];
  total: number;
  page: number;
  limit: number;
}

@SubCommand({ name: 'ls', description: 'List logged time' })
export class TasksTimeLsCommand extends CommandRunner {
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

  @Option({ flags: '--project <key>', description: 'Project key or id' })
  parseProject(v: string): string {
    return v;
  }

  @Option({ flags: '--task <addr>', description: 'Task address (KEY-NUMBER) or id' })
  parseTask(v: string): string {
    return v;
  }

  @Option({ flags: '--user-id <uuid>', description: 'Filter by user' })
  parseUserId(v: string): string {
    return v;
  }

  @Option({ flags: '--from <date>', description: 'YYYY-MM-DD' })
  parseFrom(v: string): string {
    return v;
  }

  @Option({ flags: '--to <date>', description: 'YYYY-MM-DD' })
  parseTo(v: string): string {
    return v;
  }

  @Option({ flags: '--page <n>', description: 'Page number (default 1)' })
  parsePage(v: string): number {
    return positiveInt('--page', v);
  }

  // 50, not the 20 most other `ls` commands default to: `listTimeSchema`
  // (api/src/features/projects/dto/task.dto.ts) genuinely defaults to 50 when
  // `--limit` is omitted, so documenting 20 here would just be wrong.
  @Option({ flags: '--limit <n>', description: 'Rows per page (default 50)' })
  parseLimit(v: string): number {
    return positiveInt('--limit', v);
  }

  async run(_params: string[], options: TimeLsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const resolver = new AddressResolver(client);

    const query = new URLSearchParams();
    if (options.project) {
      query.set('projectId', await resolver.resolve(options.project, projectByKey));
    }
    if (options.task) {
      query.set('taskId', await resolver.resolve(options.task, taskByProjectAndNumber));
    }
    if (options.userId) query.set('userId', options.userId);
    if (options.from) query.set('from', options.from);
    if (options.to) query.set('to', options.to);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<TimeEntryListEnvelope>(`/tasks/time${qs ? `?${qs}` : ''}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No time entries.\n');
      return;
    }

    // Not TASK/PROJECT/USER: TimeEntryRow carries only the raw
    // taskId/projectId/userId (see project-link.schema.ts's `timeEntries`
    // table) — no title, key or name ever comes back on this payload, so
    // rendering any of them would be a bare id (forbidden — see the REF/
    // ASSIGNEE reasoning in tasks-ls.command.ts). All three remain visible
    // in --json.
    const table = renderTable(envelope.data, [
      { header: 'DATE', value: (e) => e.workDate },
      { header: 'MINUTES', value: (e) => String(e.minutes), align: 'right' },
      { header: 'BILLABLE', value: (e) => (e.isBillable ? '*' : '') },
      { header: 'DESCRIPTION', value: (e) => e.description ?? '', maxWidth: 50 },
    ]);
    process.stdout.write(`${table}\n`);

    const note = morePagesNote(envelope);
    if (note) process.stdout.write(`\n${note}\n`);
  }
}
