import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import { buildProjectDocument, buildProjectPatch, type ProjectRecord } from './projects.helpers';

interface EditOptions {
  profile?: string;
  api?: string;
}

@SubCommand({ name: 'edit', arguments: '<addr>', description: 'Edit a project' })
export class ProjectsEditCommand extends CommandRunner {
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

    const id = await new AddressResolver(client).resolve(addr, projectByKey);
    const record = await client.get<ProjectRecord>(`/projects/${id}`);

    await this.editor.run({
      initial: buildProjectDocument(record),
      filetype: 'md',
      submit: async (doc) => {
        const patch = buildProjectPatch(record, doc);

        if (Object.keys(patch).length === 0) {
          process.stdout.write('No changes to save.\n');
          return;
        }

        // Like contacts, UpdateProjectDto carries no `expectedVersion` field,
        // so a rejection here (404, 403, or a 400 with issues) propagates
        // through EditorService's generic retry/throw logic unmodified.
        const updated = await client.patch<ProjectRecord>(`/projects/${id}`, patch);
        process.stdout.write(`Updated "${updated.key}" — ${updated.name}.\n`);
      },
    });
  }
}
