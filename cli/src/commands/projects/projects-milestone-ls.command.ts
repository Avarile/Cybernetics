import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import { renderTable } from '../../core/render/table';
import type { MilestoneRecord } from './projects.helpers';

interface MilestoneLsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'ls', arguments: '<addr>', description: "List a project's milestones" })
export class ProjectsMilestoneLsCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw milestone list' })
  parseJson(): boolean {
    return true;
  }

  async run(params: string[], options: MilestoneLsOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, projectByKey);

    // Not paginated — `ProjectController_milestones` takes no query params
    // and returns a plain array (see operations.ts and
    // PlanningRepository.listMilestones).
    const milestones = await client.get<MilestoneRecord[]>(`/projects/${id}/milestones`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(milestones, null, 2)}\n`);
      return;
    }

    if (milestones.length === 0) {
      process.stdout.write('No milestones.\n');
      return;
    }

    const table = renderTable(milestones, [
      // The full id, not a truncated one: this is the one place a user
      // reads an id and retypes it verbatim, into `milestone edit`/`rm`.
      { header: 'ID', value: (m) => m.id },
      { header: 'NAME', value: (m) => m.name },
      { header: 'STATUS', value: (m) => m.status },
      { header: 'DUE', value: (m) => m.dueDate ?? '' },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
