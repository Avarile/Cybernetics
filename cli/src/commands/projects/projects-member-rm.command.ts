import { Optional } from '@nestjs/common';
import { confirm as promptConfirm } from '@inquirer/prompts';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import type { ProjectMemberRecord } from './projects.helpers';

export type ConfirmPrompt = (message: string) => Promise<boolean>;

interface MemberRmOptions {
  profile?: string;
  api?: string;
  yes?: boolean;
}

@SubCommand({ name: 'rm', arguments: '<addr> <userId>', description: 'Remove a project member' })
export class ProjectsMemberRmCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
    @Optional()
    private readonly confirmPrompt: ConfirmPrompt = (message) =>
      promptConfirm({ message, default: false }),
    @Optional() private readonly isTTY: () => boolean = () => Boolean(process.stdin.isTTY),
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

  @Option({ flags: '--yes', description: 'Skip the confirmation prompt' })
  parseYes(): boolean {
    return true;
  }

  async run(params: string[], options: MemberRmOptions): Promise<void> {
    const [addr, userId] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, projectByKey);

    // `/projects/{id}/members` has no by-user lookup, only the full list —
    // fetched here so the member actually belongs to this project and so
    // their role can name them in the confirmation, rather than confirming a
    // bare id (same pattern as ContactsChannelRmCommand).
    const members = await client.get<ProjectMemberRecord[]>(`/projects/${id}/members`);
    const member = members.find((m) => m.userId === userId);
    if (!member) {
      throw new UsageError(`No member matches "${userId}" on this project.`);
    }

    if (!options.yes) {
      if (!this.isTTY()) {
        throw new UsageError(
          `Refusing to remove member "${userId}" (${member.roleInProject}) without --yes in a non-interactive session.`,
        );
      }
      const confirmed = await this.confirmPrompt(`Remove member "${userId}" (${member.roleInProject})?`);
      if (!confirmed) {
        process.stdout.write('Aborted.\n');
        return;
      }
    }

    await client.del(`/projects/${id}/members/${userId}`);
    process.stdout.write(`Removed member "${userId}".\n`);
  }
}
