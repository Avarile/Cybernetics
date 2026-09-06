import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, taskByProjectAndNumber } from '../../core/resolve/resolver';
import type { TaskRecord } from './tasks.helpers';

interface MvOptions {
  profile?: string;
  api?: string;
  status?: string;
  after?: string;
}

@SubCommand({ name: 'mv', arguments: '<addr>', description: 'Move a task on the board' })
export class TasksMvCommand extends CommandRunner {
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

  @Option({ flags: '--status <status>', description: 'New column: backlog|todo|in_progress|blocked|in_review|done|cancelled' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({
    flags: '--after <addr>',
    description: 'Place after this task (KEY-NUMBER or id); omit for the top of the column',
  })
  parseAfter(v: string): string {
    return v;
  }

  async run(params: string[], options: MvOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const resolver = new AddressResolver(client);

    const id = await resolver.resolve(addr, taskByProjectAndNumber);

    const dto: Record<string, unknown> = {};
    if (options.status !== undefined) dto.status = options.status;
    if (options.after !== undefined) {
      dto.afterTaskId = await resolver.resolve(options.after, taskByProjectAndNumber);
    }

    const moved = await client.post<TaskRecord>(`/tasks/${id}/move`, dto);
    process.stdout.write(`Moved "${moved.title}" (status: ${moved.status}).\n`);
  }
}
