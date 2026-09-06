import { Optional } from '@nestjs/common';
import { confirm as promptConfirm } from '@inquirer/prompts';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import type { MilestoneRecord } from './projects.helpers';

export type ConfirmPrompt = (message: string) => Promise<boolean>;

interface MilestoneRmOptions {
  profile?: string;
  api?: string;
  yes?: boolean;
}

@SubCommand({ name: 'rm', arguments: '<addr> <milestoneId>', description: 'Delete a milestone' })
export class ProjectsMilestoneRmCommand extends CommandRunner {
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

  async run(params: string[], options: MilestoneRmOptions): Promise<void> {
    const [addr, milestoneId] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, projectByKey);

    const milestones = await client.get<MilestoneRecord[]>(`/projects/${id}/milestones`);
    const record = milestones.find((m) => m.id === milestoneId);
    if (!record) {
      throw new UsageError(`No milestone matches "${milestoneId}" on this project.`);
    }

    if (!options.yes) {
      if (!this.isTTY()) {
        throw new UsageError(
          `Refusing to delete milestone "${record.name}" without --yes in a non-interactive session.`,
        );
      }
      const confirmed = await this.confirmPrompt(`Delete milestone "${record.name}"?`);
      if (!confirmed) {
        process.stdout.write('Aborted.\n');
        return;
      }
    }

    await client.del(`/projects/milestones/${milestoneId}`);
    process.stdout.write(`Deleted milestone "${record.name}".\n`);
  }
}
