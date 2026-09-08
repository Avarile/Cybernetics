import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import { renderTable } from '../../core/render/table';
import type { ProjectMemberRecord } from './projects.helpers';

interface MemberLsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'ls', arguments: '<addr>', description: "List a project's members" })
export class ProjectsMemberLsCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw member list' })
  parseJson(): boolean {
    return true;
  }

  async run(params: string[], options: MemberLsOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, projectByKey);

    // Not paginated — GET /projects/{id}/members (ProjectController_members
    // in operations.ts) takes no query params and returns a plain array.
    const members = await client.get<ProjectMemberRecord[]>(`/projects/${id}/members`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(members, null, 2)}\n`);
      return;
    }

    if (members.length === 0) {
      process.stdout.write('No members.\n');
      return;
    }

    const table = renderTable(members, [
      // The full user id, not a truncated one: this is the one place a user
      // reads an id and retypes it verbatim, into `member rm <addr> <userId>`.
      { header: 'USER ID', value: (m) => m.userId },
      { header: 'ROLE', value: (m) => m.roleInProject },
      { header: 'ADDED', value: (m) => m.joinedAt },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
