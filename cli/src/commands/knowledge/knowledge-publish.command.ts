import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, knowledgeBySlug } from '../../core/resolve/resolver';
import type { KnowledgeRecord } from './knowledge.helpers';

interface PublishOptions {
  profile?: string;
  api?: string;
  status?: string;
  note?: string;
}

const DEFAULT_STATUS = 'published';

@SubCommand({ name: 'publish', arguments: '<addr>', description: 'Move a record through its lifecycle' })
export class KnowledgePublishCommand extends CommandRunner {
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

  @Option({ flags: '--status <status>', description: `Target status (default: ${DEFAULT_STATUS})` })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--note <text>', description: 'Optional transition note' })
  parseNote(v: string): string {
    return v;
  }

  async run(params: string[], options: PublishOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const id = await new AddressResolver(client).resolve(addr, knowledgeBySlug);

    const body: Record<string, unknown> = { status: options.status ?? DEFAULT_STATUS };
    if (options.note !== undefined) body.note = options.note;

    const updated = await client.post<KnowledgeRecord>(`/knowledge/${id}/status`, body);
    process.stdout.write(`"${updated.slug}" is now ${updated.status}.\n`);
  }
}
