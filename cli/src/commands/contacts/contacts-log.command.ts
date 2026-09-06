import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, contactByEmailOrName } from '../../core/resolve/resolver';
import type { ContactInteractionRecord } from './contacts.helpers';

interface LogOptions {
  profile?: string;
  api?: string;
  kind?: string;
  subject?: string;
  body?: string;
  direction?: string;
  projectId?: string;
  durationMinutes?: number;
  occurredAt?: string;
}

function positiveInt(flag: string, v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) {
    throw new UsageError(`${flag} must be a non-negative integer, got "${v}".`);
  }
  return n;
}

@SubCommand({ name: 'log', arguments: '<addr>', description: 'Log an interaction with a contact' })
export class ContactsLogCommand extends CommandRunner {
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

  @Option({ flags: '--kind <kind>', description: 'email_in|email_out|call|meeting|note|task|other' })
  parseKind(v: string): string {
    return v;
  }

  @Option({ flags: '--subject <text>', description: 'Subject' })
  parseSubject(v: string): string {
    return v;
  }

  @Option({ flags: '--body <text>', description: 'Body / notes' })
  parseBody(v: string): string {
    return v;
  }

  @Option({ flags: '--direction <direction>', description: 'inbound|outbound|internal' })
  parseDirection(v: string): string {
    return v;
  }

  @Option({ flags: '--project-id <uuid>', description: 'Associated project id' })
  parseProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--duration-minutes <n>', description: 'Duration in minutes' })
  parseDurationMinutes(v: string): number {
    return positiveInt('--duration-minutes', v);
  }

  @Option({ flags: '--occurred-at <date>', description: 'ISO date/timestamp (default now)' })
  parseOccurredAt(v: string): string {
    return v;
  }

  async run(params: string[], options: LogOptions): Promise<void> {
    const [addr] = params;
    if (options.kind === undefined) throw new UsageError('--kind is required.');

    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, contactByEmailOrName);

    const dto: Record<string, unknown> = { kind: options.kind };
    if (options.subject !== undefined) dto.subject = options.subject;
    if (options.body !== undefined) dto.body = options.body;
    if (options.direction !== undefined) dto.direction = options.direction;
    if (options.projectId !== undefined) dto.projectId = options.projectId;
    if (options.durationMinutes !== undefined) dto.durationMinutes = options.durationMinutes;
    if (options.occurredAt !== undefined) dto.occurredAt = options.occurredAt;

    const interaction = await client.post<ContactInteractionRecord>(
      `/contacts/${id}/interactions`,
      dto,
    );
    process.stdout.write(`Logged ${interaction.kind} interaction (${interaction.id}).\n`);
  }
}
