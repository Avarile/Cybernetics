import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, taskByProjectAndNumber } from '../../core/resolve/resolver';

/** `GET /tasks/{id}/time` response record (`TimeEntryRow`, see project-link.schema.ts). */
export interface TimeEntryRecord {
  id: string;
  taskId: string | null;
  projectId: string;
  userId: string;
  startedAt: string | null;
  minutes: number;
  workDate: string;
  description: string | null;
  isBillable: boolean;
  hourlyRate: string | null;
  currency: string | null;
  invoiceLineItemId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

interface TimeLogOptions {
  profile?: string;
  api?: string;
  minutes?: number;
  workDate?: string;
  startedAt?: string;
  description?: string;
  billable?: boolean;
  hourlyRate?: string;
  currency?: string;
}

function positiveInt(flag: string, v: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new UsageError(`${flag} must be a positive integer, got "${v}".`);
  }
  return n;
}

@SubCommand({ name: 'log', arguments: '<addr>', description: 'Log time against a task (accepts KEY-NUMBER)' })
export class TasksTimeLogCommand extends CommandRunner {
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

  @Option({ flags: '--minutes <n>', description: 'Duration in minutes (1-1440)' })
  parseMinutes(v: string): number {
    return positiveInt('--minutes', v);
  }

  @Option({ flags: '--work-date <date>', description: 'The day the work is attributed to (YYYY-MM-DD)' })
  parseWorkDate(v: string): string {
    return v;
  }

  @Option({ flags: '--started-at <date>', description: 'ISO timestamp' })
  parseStartedAt(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--billable', description: 'Mark this entry billable' })
  parseBillable(): boolean {
    return true;
  }

  @Option({ flags: '--hourly-rate <amount>', description: 'Decimal amount' })
  parseHourlyRate(v: string): string {
    return v;
  }

  @Option({ flags: '--currency <code>', description: 'Three-letter currency code' })
  parseCurrency(v: string): string {
    return v;
  }

  async run(params: string[], options: TimeLogOptions): Promise<void> {
    const [addr] = params;
    if (options.minutes === undefined) throw new UsageError('--minutes is required.');
    if (options.workDate === undefined) throw new UsageError('--work-date is required.');

    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, taskByProjectAndNumber);

    const dto: Record<string, unknown> = { minutes: options.minutes, workDate: options.workDate };
    if (options.startedAt !== undefined) dto.startedAt = options.startedAt;
    if (options.description !== undefined) dto.description = options.description;
    if (options.billable !== undefined) dto.isBillable = options.billable;
    if (options.hourlyRate !== undefined) dto.hourlyRate = options.hourlyRate;
    if (options.currency !== undefined) dto.currency = options.currency;

    const entry = await client.post<TimeEntryRecord>(`/tasks/${id}/time`, dto);
    process.stdout.write(`Logged ${entry.minutes} minute(s) (${entry.id}).\n`);
  }
}
