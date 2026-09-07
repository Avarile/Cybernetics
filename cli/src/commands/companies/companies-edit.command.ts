import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { ClientFactory } from '../../core/http/client.factory';
import { buildCompanyDocument, buildCompanyPatch, type CompanyRecord } from './companies.helpers';

interface EditOptions {
  profile?: string;
  api?: string;
}

@SubCommand({ name: 'edit', arguments: '<id>', description: 'Edit a company' })
export class CompaniesEditCommand extends CommandRunner {
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
    const [id] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const record = await client.get<CompanyRecord>(`/companies/${id}`);

    await this.editor.run({
      initial: buildCompanyDocument(record),
      filetype: 'md',
      submit: async (doc) => {
        const patch = buildCompanyPatch(record, doc);

        if (Object.keys(patch).length === 0) {
          process.stdout.write('No changes to save.\n');
          return;
        }

        const updated = await client.patch<CompanyRecord>(`/companies/${id}`, patch);
        process.stdout.write(`Updated "${updated.name}".\n`);
      },
    });
  }
}
