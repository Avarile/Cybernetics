import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, contactByEmailOrName } from '../../core/resolve/resolver';
import { buildContactDocument, type ContactRecord } from './contacts.helpers';

interface GetOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'get', arguments: '<addr>', description: 'Show a contact' })
export class ContactsGetCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw record' })
  parseJson(): boolean {
    return true;
  }

  async run(params: string[], options: GetOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, contactByEmailOrName);
    const record = await client.get<ContactRecord>(`/contacts/${id}`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
      return;
    }

    // Same shape `edit` opens the buffer with, so a user who wants to change
    // what they see here already knows what the editor will look like.
    const text = buildContactDocument(record);
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}
