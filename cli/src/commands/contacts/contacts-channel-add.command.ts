import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, contactByEmailOrName } from '../../core/resolve/resolver';
import type { ContactChannelRecord } from './contacts.helpers';

interface ChannelAddOptions {
  profile?: string;
  api?: string;
  kind?: string;
  value?: string;
  label?: string;
  primary?: boolean;
}

@SubCommand({ name: 'add', arguments: '<addr>', description: 'Add a contact channel' })
export class ContactsChannelAddCommand extends CommandRunner {
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

  @Option({
    flags: '--kind <kind>',
    description: 'email|phone|mobile|fax|website|linkedin|twitter|wechat|whatsapp|other',
  })
  parseKind(v: string): string {
    return v;
  }

  @Option({ flags: '--value <text>', description: 'Channel value (e.g. the address or number)' })
  parseValue(v: string): string {
    return v;
  }

  @Option({ flags: '--label <text>', description: 'Optional label' })
  parseLabel(v: string): string {
    return v;
  }

  @Option({ flags: '--primary', description: 'Make this the primary channel of its kind' })
  parsePrimary(): boolean {
    return true;
  }

  async run(params: string[], options: ChannelAddOptions): Promise<void> {
    const [addr] = params;
    if (options.kind === undefined) throw new UsageError('--kind is required.');
    if (options.value === undefined) throw new UsageError('--value is required.');

    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, contactByEmailOrName);

    const dto: Record<string, unknown> = { kind: options.kind, value: options.value };
    if (options.label !== undefined) dto.label = options.label;
    if (options.primary !== undefined) dto.isPrimary = options.primary;

    const channel = await client.post<ContactChannelRecord>(`/contacts/${id}/channels`, dto);
    process.stdout.write(`Added ${channel.kind} channel "${channel.value}" (${channel.id}).\n`);
  }
}
