import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import { MILESTONE_CREATE_SCHEMA, type MilestoneRecord } from './projects.helpers';

interface MilestoneAddOptions {
  profile?: string;
  api?: string;
  edit?: boolean;
  name?: string;
  description?: string;
  status?: string;
  dueDate?: string;
  ownerUserId?: string;
  sortOrder?: number;
}

const FIELD_OPTION_KEYS: (keyof MilestoneAddOptions)[] = [
  'name',
  'description',
  'status',
  'dueDate',
  'ownerUserId',
  'sortOrder',
];

const MILESTONE_TEMPLATE_HEADER = [
  'dueDate is a date: YYYY-MM-DD, or a full timestamp (YYYY-MM-DDTHH:MM:SSZ).',
  "Everything below the closing --- becomes the milestone's description.",
];

@SubCommand({ name: 'add', arguments: '<addr>', description: 'Create a milestone on a project' })
export class ProjectsMilestoneAddCommand extends CommandRunner {
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

  @Option({ flags: '--edit', description: 'Force opening the editor even when field flags are given' })
  parseEdit(): boolean {
    return true;
  }

  @Option({ flags: '--no-edit', description: 'Never open the editor; use field flags only' })
  parseNoEdit(): boolean {
    return false;
  }

  @Option({ flags: '--name <text>', description: 'Milestone name' })
  parseName(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'pending|in_progress|reached|missed|cancelled (default pending)' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--due-date <date>', description: 'ISO date' })
  parseDueDate(v: string): string {
    return v;
  }

  @Option({ flags: '--owner-user-id <uuid>', description: 'Owner user id' })
  parseOwnerUserId(v: string): string {
    return v;
  }

  @Option({ flags: '--sort-order <n>', description: 'Sort order (default 0)' })
  parseSortOrder(v: string): number {
    return Number(v);
  }

  async run(params: string[], options: MilestoneAddOptions): Promise<void> {
    const [addr] = params;
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);
    const id = await new AddressResolver(client).resolve(addr, projectByKey);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --name (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<MilestoneRecord>(`/projects/${id}/milestones`, dto);
      process.stdout.write(`Created milestone "${created.name}" (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: MILESTONE_CREATE_SCHEMA,
        bodyField: 'description',
        header: MILESTONE_TEMPLATE_HEADER,
      });
      await this.editor.run({
        initial,
        filetype: 'md',
        submit: async (doc) => {
          const dto: Record<string, unknown> = { ...doc.fields };
          if (doc.body) dto.description = doc.body;
          await create(dto);
        },
      });
      return;
    }

    if (options.name === undefined) throw new UsageError('--name is required.');

    const dto: Record<string, unknown> = { name: options.name };
    if (options.description !== undefined) dto.description = options.description;
    if (options.status !== undefined) dto.status = options.status;
    if (options.dueDate !== undefined) dto.dueDate = options.dueDate;
    if (options.ownerUserId !== undefined) dto.ownerUserId = options.ownerUserId;
    if (options.sortOrder !== undefined) dto.sortOrder = options.sortOrder;

    await create(dto);
  }
}
