import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import { buildMilestoneDocument, buildMilestonePatch, type MilestoneRecord } from './projects.helpers';

interface MilestoneEditOptions {
  profile?: string;
  api?: string;
}

@SubCommand({ name: 'edit', arguments: '<addr> <milestoneId>', description: 'Edit a milestone' })
export class ProjectsMilestoneEditCommand extends CommandRunner {
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

  async run(params: string[], options: MilestoneEditOptions): Promise<void> {
    const [addr, milestoneId] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, projectByKey);

    // There is no `GET` for a single milestone (only list, create, update,
    // remove — see operations.ts), so the current record for the edit
    // buffer comes from the list, matched by id (same shape as
    // ContactsChannelRmCommand needing the full list to find one channel).
    const milestones = await client.get<MilestoneRecord[]>(`/projects/${id}/milestones`);
    const record = milestones.find((m) => m.id === milestoneId);
    if (!record) {
      throw new UsageError(`No milestone matches "${milestoneId}" on this project.`);
    }

    await this.editor.run({
      initial: buildMilestoneDocument(record),
      filetype: 'md',
      submit: async (doc) => {
        const patch = buildMilestonePatch(record, doc);

        if (Object.keys(patch).length === 0) {
          process.stdout.write('No changes to save.\n');
          return;
        }

        const updated = await client.patch<MilestoneRecord>(`/projects/milestones/${milestoneId}`, patch);
        process.stdout.write(`Updated milestone "${updated.name}".\n`);
      },
    });
  }
}
