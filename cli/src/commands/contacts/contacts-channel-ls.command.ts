import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, contactByEmailOrName } from '../../core/resolve/resolver';
import { renderTable } from '../../core/render/table';
import type { ContactChannelRecord } from './contacts.helpers';

interface ChannelLsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
}

@SubCommand({ name: 'ls', arguments: '<addr>', description: "List a contact's channels" })
export class ContactsChannelLsCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw channel list' })
  parseJson(): boolean {
    return true;
  }

  async run(params: string[], options: ChannelLsOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, contactByEmailOrName);

    // Not paginated — GET /contacts/{id}/channels takes no query params (see
    // ContactController_channels in operations.ts) and returns a plain array.
    const channels = await client.get<ContactChannelRecord[]>(`/contacts/${id}/channels`);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(channels, null, 2)}\n`);
      return;
    }

    if (channels.length === 0) {
      process.stdout.write('No channels.\n');
      return;
    }

    const table = renderTable(channels, [
      // The full id, not a truncated one: this is the one place a user reads
      // an id and retypes it verbatim, into `channel rm <addr> <channelId>`.
      { header: 'ID', value: (c) => c.id },
      { header: 'KIND', value: (c) => c.kind },
      { header: 'VALUE', value: (c) => c.value },
      { header: 'LABEL', value: (c) => c.label ?? '' },
      { header: 'PRIMARY', value: (c) => (c.isPrimary ? '*' : '') },
    ]);
    process.stdout.write(`${table}\n`);
  }
}
