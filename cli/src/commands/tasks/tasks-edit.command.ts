import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, taskByProjectAndNumber } from '../../core/resolve/resolver';
import { buildTaskDocument, buildTaskPatch, type TaskRecord } from './tasks.helpers';

interface EditOptions {
  profile?: string;
  api?: string;
}

@SubCommand({ name: 'edit', arguments: '<addr>', description: 'Edit a task (accepts KEY-NUMBER, e.g. CYB-42)' })
export class TasksEditCommand extends CommandRunner {
  constructor(
    private readonly settings: SettingsService,
    private readonly clients: ClientFactory,
    @Optional() private readonly editor: EditorService = new EditorService(),
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

  async run(params: string[], options: EditOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, taskByProjectAndNumber);
    const record = await client.get<TaskRecord>(`/tasks/${id}`);

    await this.editor.run({
      initial: buildTaskDocument(record),
      filetype: 'md',
      submit: async (doc) => {
        const patch = buildTaskPatch(record, doc);

        if (Object.keys(patch).length === 0) {
          process.stdout.write('No changes to save.\n');
          return;
        }

        // Like contacts/projects, UpdateTaskDto carries no `expectedVersion`
        // field. A move to `blocked` with no `blockedReason` (existing or
        // newly typed) 400s with an issue at that path — TaskService.update
        // enforces it server-side, not the DTO schema — and that issue
        // propagates through EditorService's generic retry/throw logic
        // unmodified, same as any other fixable validation issue.
        const updated = await client.patch<TaskRecord>(`/tasks/${id}`, patch);
        process.stdout.write(`Updated "${updated.title}".\n`);
      },
    });
  }
}
