import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';

interface MemberAddOptions {
  profile?: string;
  api?: string;
  userId?: string;
  role?: string;
}

@SubCommand({ name: 'add', arguments: '<addr>', description: 'Add or re-role a project member' })
export class ProjectsMemberAddCommand extends CommandRunner {
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

  @Option({ flags: '--user-id <uuid>', description: 'User to add' })
  parseUserId(v: string): string {
    return v;
  }

  // `owner` is deliberately absent: a project has one accountable owner, and
  // ownership moves by editing `ownerUserId` through `projects edit`, which
  // also maintains the membership row that mirrors it. Granting `owner` here
  // let a manager promote themselves past the role that gated the endpoint.
  @Option({ flags: '--role <role>', description: 'manager|contributor|viewer (default contributor)' })
  parseRole(v: string): string {
    return v;
  }

  async run(params: string[], options: MemberAddOptions): Promise<void> {
    const [addr] = params;
    if (options.userId === undefined) throw new UsageError('--user-id is required.');

    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, projectByKey);

    const dto: Record<string, unknown> = { userId: options.userId };
    if (options.role !== undefined) dto.roleInProject = options.role;

    // `ProjectController_addMember` returns 204 with no body — there is
    // nothing in the response to name the member by, so the message echoes
    // back what was sent.
    await client.post(`/projects/${id}/members`, dto);
    process.stdout.write(`Added ${options.userId} as ${options.role ?? 'contributor'} to "${addr}".\n`);
  }
}
