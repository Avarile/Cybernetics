import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { positiveInt } from '../../core/cli/positive-int';
import { AddressResolver, contactByEmailOrName } from '../../core/resolve/resolver';
import { renderTable } from '../../core/render/table';
import { morePagesNote, type ContactInteractionListEnvelope } from './contacts.helpers';

interface InteractionsOptions {
  profile?: string;
  api?: string;
  json?: boolean;
  page?: number;
  limit?: number;
}

@SubCommand({ name: 'interactions', arguments: '<addr>', description: "A contact's interaction timeline" })
export class ContactsInteractionsCommand extends CommandRunner {
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

  @Option({ flags: '--json', description: 'Emit the raw list envelope' })
  parseJson(): boolean {
    return true;
  }

  @Option({ flags: '--page <n>', description: 'Page number (default 1)' })
  parsePage(v: string): number {
    return positiveInt('--page', v);
  }

  @Option({ flags: '--limit <n>', description: 'Rows per page (default 20)' })
  parseLimit(v: string): number {
    return positiveInt('--limit', v);
  }

  async run(params: string[], options: InteractionsOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, contactByEmailOrName);

    const query = new URLSearchParams();
    if (options.page) query.set('page', String(options.page));
    if (options.limit) query.set('limit', String(options.limit));

    const qs = query.toString();
    const envelope = await client.get<ContactInteractionListEnvelope>(
      `/contacts/${id}/interactions${qs ? `?${qs}` : ''}`,
    );

    if (options.json) {
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
      return;
    }

    if (envelope.data.length === 0) {
      process.stdout.write('No interactions.\n');
      return;
    }

    const table = renderTable(envelope.data, [
      { header: 'OCCURRED', value: (r) => r.occurredAt },
      { header: 'KIND', value: (r) => r.kind },
      { header: 'SUBJECT', value: (r) => r.subject ?? '', maxWidth: 40 },
      { header: 'DIRECTION', value: (r) => r.direction ?? '' },
    ]);
    process.stdout.write(`${table}\n`);

    const note = morePagesNote(envelope);
    if (note) process.stdout.write(`\n${note}\n`);
  }
}
