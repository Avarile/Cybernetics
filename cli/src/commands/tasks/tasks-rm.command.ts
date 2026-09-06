import { Optional } from '@nestjs/common';
import { confirm as promptConfirm } from '@inquirer/prompts';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, taskByProjectAndNumber } from '../../core/resolve/resolver';
import type { TaskRecord } from './tasks.helpers';

export type ConfirmPrompt = (message: string) => Promise<boolean>;

interface RmOptions {
  profile?: string;
  api?: string;
  yes?: boolean;
}

@SubCommand({ name: 'rm', arguments: '<addr>', description: 'Delete a task (accepts KEY-NUMBER, e.g. CYB-42)' })
export class TasksRmCommand extends CommandRunner {
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

  async run(params: string[], options: RmOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, taskByProjectAndNumber);
    const record = await client.get<TaskRecord>(`/tasks/${id}`);

    if (!options.yes) {
      if (!this.isTTY()) {
        throw new UsageError(
          `Refusing to delete "${record.title}" without --yes in a non-interactive session.`,
        );
      }
      const confirmed = await this.confirmPrompt(`Delete "${record.title}"?`);
      if (!confirmed) {
        process.stdout.write('Aborted.\n');
        return;
      }
    }

    await client.del(`/tasks/${id}`);
    process.stdout.write(`Deleted "${record.title}".\n`);
  }
}
