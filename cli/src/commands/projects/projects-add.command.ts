import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { PROJECTS_CREATE_SCHEMA, PROJECTS_TEMPLATE_HEADER, type ProjectRecord } from './projects.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /**
   * Three states via commander's dual-option support (`--edit` registered
   * before `--no-edit` in this class so its presence suppresses the
   * negate-implied default — see ContactsAddCommand for the same pattern).
   */
  edit?: boolean;
  key?: string;
  name?: string;
  description?: string;
  status?: string;
  priority?: string;
  leadUserId?: string;
  parentProjectId?: string;
  visibility?: string;
  startDate?: string;
  dueDate?: string;
  budgetAmount?: string;
  currency?: string;
  color?: string;
  tags?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'key',
  'name',
  'description',
  'status',
  'priority',
  'leadUserId',
  'parentProjectId',
  'visibility',
  'startDate',
  'dueDate',
  'budgetAmount',
  'currency',
  'color',
  'tags',
];

@SubCommand({ name: 'add', description: 'Create a project' })
export class ProjectsAddCommand extends CommandRunner {
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

  // See ContactsAddCommand.parseNoEdit for why this must return `false`.
  @Option({ flags: '--no-edit', description: 'Never open the editor; use field flags only' })
  parseNoEdit(): boolean {
    return false;
  }

  @Option({ flags: '--key <key>', description: 'Project key, UPPER_SNAKE_CASE (e.g. ACME)' })
  parseKey(v: string): string {
    return v;
  }

  @Option({ flags: '--name <text>', description: 'Project name' })
  parseName(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'draft|active|on_hold|completed|archived|cancelled (default draft)' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--priority <priority>', description: 'low|medium|high|urgent (default medium)' })
  parsePriority(v: string): string {
    return v;
  }

  @Option({ flags: '--lead-user-id <uuid>', description: 'Lead user id' })
  parseLeadUserId(v: string): string {
    return v;
  }

  @Option({ flags: '--parent-project-id <uuid>', description: 'Parent project id' })
  parseParentProjectId(v: string): string {
    return v;
  }

  @Option({ flags: '--visibility <visibility>', description: 'private|internal (default private)' })
  parseVisibility(v: string): string {
    return v;
  }

  @Option({ flags: '--start-date <date>', description: 'ISO date' })
  parseStartDate(v: string): string {
    return v;
  }

  @Option({ flags: '--due-date <date>', description: 'ISO date' })
  parseDueDate(v: string): string {
    return v;
  }

  @Option({ flags: '--budget-amount <amount>', description: 'Decimal amount' })
  parseBudgetAmount(v: string): string {
    return v;
  }

  @Option({ flags: '--currency <code>', description: 'Three-letter currency code' })
  parseCurrency(v: string): string {
    return v;
  }

  @Option({ flags: '--color <color>', description: 'Display color' })
  parseColor(v: string): string {
    return v;
  }

  @Option({ flags: '--tags <ids>', description: 'Comma-separated tag UUIDs' })
  parseTags(v: string): string {
    return v;
  }

  async run(_params: string[], options: AddOptions): Promise<void> {
    const resolved = this.settings.resolve(options);
    const client = this.clients.create(resolved);

    const fieldFlagsGiven = FIELD_OPTION_KEYS.some((key) => options[key] !== undefined);
    const wantsEditor = options.edit === true || (options.edit !== false && !fieldFlagsGiven);

    if (!wantsEditor && !fieldFlagsGiven) {
      throw new UsageError(
        'No fields given and --no-edit forbids the editor. Pass --key and --name (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<ProjectRecord>('/projects', dto);
      process.stdout.write(`Created "${created.key}" — ${created.name} (${created.id}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: PROJECTS_CREATE_SCHEMA,
        bodyField: 'description',
        header: PROJECTS_TEMPLATE_HEADER,
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

    // Unlike contacts, `key` and `name` really are required in
    // CreateProjectDto's JSON Schema (confirmed against
    // src/generated/schemas.ts: `required: ["key", "name"]`), so flag mode
    // checks for them up front rather than round-tripping to the server for
    // an error the CLI can already see.
    if (options.key === undefined) throw new UsageError('--key is required.');
    if (options.name === undefined) throw new UsageError('--name is required.');

    const dto: Record<string, unknown> = { key: options.key, name: options.name };
    if (options.description !== undefined) dto.description = options.description;
    if (options.status !== undefined) dto.status = options.status;
    if (options.priority !== undefined) dto.priority = options.priority;
    if (options.leadUserId !== undefined) dto.leadUserId = options.leadUserId;
    if (options.parentProjectId !== undefined) dto.parentProjectId = options.parentProjectId;
    if (options.visibility !== undefined) dto.visibility = options.visibility;
    if (options.startDate !== undefined) dto.startDate = options.startDate;
    if (options.dueDate !== undefined) dto.dueDate = options.dueDate;
    if (options.budgetAmount !== undefined) dto.budgetAmount = options.budgetAmount;
    if (options.currency !== undefined) dto.currency = options.currency;
    if (options.color !== undefined) dto.color = options.color;
    if (options.tags !== undefined) {
      dto.tagIds = options.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    await create(dto);
  }
}
