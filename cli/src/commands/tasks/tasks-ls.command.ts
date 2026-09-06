import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { renderTable } from '../../core/render/table';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import { morePagesNote, resolveProjectKeys, type TaskListEnvelope } from './tasks.helpers';

interface LsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  project?: string;
  status?: string;
  assigneeUserId?: string;
  milestoneId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

@SubCommand({ name: 'ls', description: 'List tasks' })
export class TasksLsCommand extends CommandRunner {
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

  @Option({ flags: '--project <key>', description: 'Project key or id to scope the list to' })
  parseProject(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'backlog|todo|in_progress|blocked|in_review|done|cancelled' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--assignee-user-id <uuid>', description: 'Filter by assignee' })
  parseAssigneeUserId(v: string): string {
    return v;
  }

  @Option({ flags: '--milestone-id <uuid>', description: 'Filter by milestone' })
  parseMilestoneId(v: string): string {
    return v;
  }

  @Option({ flags: '--search <text>', description: 'Search title' })
  parseSearch(v: string): string {
    return v;
  }

  @Option({ flags: '--page <n>', description: 'Page number (default 1)' })
  parsePage(v: string): number {
    return positiveInt('--page', v);
  }

  // 50, not the 20 most other `ls` commands default to: `listTasksSchema`
  // (api/src/features/projects/dto/task.dto.ts) genuinely defaults to 50 when
  // `--limit` is omitted, so documenting 20 here would just be wrong.
  @Option({ flags: '--limit <n>', description: 'Rows per page (default 50)' })
  parseLimit(v: string): number {
    return positiveInt('--limit', v);
  }

  async run(_params: string[], options: LsOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    // `listTasksSchema` takes `projectId`, not a key — resolved here so the
    // rest of the command (and the REF column below) works in terms of the
    // key the user typed.
    let projectId: string | undefined;
    let knownKey: string | undefined;
    if (options.project) {
      projectId = await new AddressResolver(client).resolve(options.project, projectByKey);
      knownKey = options.project;
    }

    const query = new URLSearchParams();
    if (projectId) query.set('projectId', projectId);
    if (options.status) query.set('status', options.status);
    if (options.assigneeUserId) query.set('assigneeUserId', options.assigneeUserId);
    if (options.milestoneId) query.set('milestoneId', options.milestoneId);
    if (options.search) query.set('search', options.search);
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<TaskListEnvelope>(`/tasks${qs ? `?${qs}` : ''}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No tasks.\n');
      return;
    }

    // REF ("KEY-NUMBER"): TaskRow carries only `projectId`, never a project
    // key (see tasks.helpers.ts's TaskRecord doc comment), so it cannot be
    // rendered from the tasks payload alone. When `--project` was given
    // every row shares the key already resolved above; otherwise each
    // distinct projectId on this page is resolved once via
    // resolveProjectKeys (GET /projects/{id}, which any `user`-role caller
    // can call — see that helper's doc comment for why this is safe to do
    // per-row, unlike a `/users/{id}` lookup).
    const keysById = knownKey
      ? new Map(envelope.data.map((r) => [r.projectId, knownKey as string]))
      : await resolveProjectKeys(
          envelope.data.map((r) => r.projectId),
          client,
        );

    const table = renderTable(envelope.data, [
      {
        header: 'REF',
        value: (r) => `${(keysById.get(r.projectId) ?? r.projectId).toUpperCase()}-${r.number}`,
      },
      { header: 'TITLE', value: (r) => r.title, maxWidth: 50 },
      { header: 'STATUS', value: (r) => r.status },
      // Not ASSIGNEE: TaskRow carries only `assigneeUserId`, and resolving it
      // to a name would mean calling `GET /users/{id}`, which is
      // `@Roles('admin')`-gated (see users.controller.ts) — a lookup that
      // would 403 for the ordinary `user`-role accounts this CLI mostly
      // runs as. Rather than render a raw UUID (forbidden — see contacts'
      // dropped COMPANY column) or break for non-admins, PRIORITY takes its
      // place: always meaningful, and still resolvable to a name elsewhere
      // (an admin can cross-reference `assigneeUserId` from `--json`).
      { header: 'PRIORITY', value: (r) => r.priority },
      { header: 'DUE', value: (r) => r.dueDate ?? '' },
    ]);
    process.stdout.write(`${table}\n`);

    const note = morePagesNote(envelope);
    if (note) process.stdout.write(`\n${note}\n`);
  }
}
