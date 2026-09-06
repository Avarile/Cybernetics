import { Optional } from '@nestjs/common';
import { CommandRunner, Option, SubCommand } from 'nest-commander';
import { SettingsService } from '../../core/config/settings.service';
import { EditorService } from '../../core/editor/editor.service';
import { buildTemplate } from '../../core/editor/template';
import { UsageError } from '../../core/errors';
import { ClientFactory } from '../../core/http/client.factory';
import { AddressResolver, projectByKey } from '../../core/resolve/resolver';
import { TASKS_CREATE_SCHEMA, TASKS_TEMPLATE_HEADER, type TaskRecord } from './tasks.helpers';

interface AddOptions {
  profile?: string;
  api?: string;
  /** See ContactsAddCommand.parseEdit/parseNoEdit for why this is three-state. */
  edit?: boolean;
  project?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeUserId?: string;
  milestoneId?: string;
  parentTaskId?: string;
  estimateMinutes?: number;
  startDate?: string;
  dueDate?: string;
  tags?: string;
}

const FIELD_OPTION_KEYS: (keyof AddOptions)[] = [
  'project',
  'title',
  'description',
  'status',
  'priority',
  'assigneeUserId',
  'milestoneId',
  'parentTaskId',
  'estimateMinutes',
  'startDate',
  'dueDate',
  'tags',
];

@SubCommand({ name: 'add', description: 'Create a task' })
export class TasksAddCommand extends CommandRunner {
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

  @Option({ flags: '--project <key>', description: 'Project key or id to create the task in' })
  parseProject(v: string): string {
    return v;
  }

  @Option({ flags: '--title <text>', description: 'Task title' })
  parseTitle(v: string): string {
    return v;
  }

  @Option({ flags: '--description <text>', description: 'Description' })
  parseDescription(v: string): string {
    return v;
  }

  @Option({ flags: '--status <status>', description: 'backlog|todo|in_progress|blocked|in_review|done|cancelled (default todo)' })
  parseStatus(v: string): string {
    return v;
  }

  @Option({ flags: '--priority <priority>', description: 'low|medium|high|urgent (default medium)' })
  parsePriority(v: string): string {
    return v;
  }

  @Option({ flags: '--assignee-user-id <uuid>', description: 'Assignee user id' })
  parseAssigneeUserId(v: string): string {
    return v;
  }

  @Option({ flags: '--milestone-id <uuid>', description: 'Milestone id' })
  parseMilestoneId(v: string): string {
    return v;
  }

  @Option({ flags: '--parent-task-id <uuid>', description: 'Parent task id' })
  parseParentTaskId(v: string): string {
    return v;
  }

  @Option({ flags: '--estimate-minutes <n>', description: 'Estimate in minutes' })
  parseEstimateMinutes(v: string): number {
    return Number(v);
  }

  @Option({ flags: '--start-date <date>', description: 'ISO date' })
  parseStartDate(v: string): string {
    return v;
  }

  @Option({ flags: '--due-date <date>', description: 'ISO date' })
  parseDueDate(v: string): string {
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
        'No fields given and --no-edit forbids the editor. Pass --project and --title (and others), or drop --no-edit.',
      );
    }

    const create = async (dto: Record<string, unknown>): Promise<void> => {
      const created = await client.post<TaskRecord>('/tasks', dto);
      process.stdout.write(`Created "${created.title}" (${created.id}, #${created.number}).\n`);
    };

    if (wantsEditor) {
      const initial = buildTemplate({
        schema: TASKS_CREATE_SCHEMA,
        bodyField: 'description',
        header: TASKS_TEMPLATE_HEADER,
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

    // Unlike contacts, `projectId` and `title` really are required in
    // CreateTaskDto's JSON Schema (confirmed against
    // src/generated/schemas.ts: `required: ["projectId", "title"]`), so flag
    // mode checks for them up front.
    if (options.project === undefined) throw new UsageError('--project is required.');
    if (options.title === undefined) throw new UsageError('--title is required.');

    const projectId = await new AddressResolver(client).resolve(options.project, projectByKey);

    const dto: Record<string, unknown> = { projectId, title: options.title };
    if (options.description !== undefined) dto.description = options.description;
    if (options.status !== undefined) dto.status = options.status;
    if (options.priority !== undefined) dto.priority = options.priority;
    if (options.assigneeUserId !== undefined) dto.assigneeUserId = options.assigneeUserId;
    if (options.milestoneId !== undefined) dto.milestoneId = options.milestoneId;
    if (options.parentTaskId !== undefined) dto.parentTaskId = options.parentTaskId;
    if (options.estimateMinutes !== undefined) dto.estimateMinutes = options.estimateMinutes;
    if (options.startDate !== undefined) dto.startDate = options.startDate;
    if (options.dueDate !== undefined) dto.dueDate = options.dueDate;
    if (options.tags !== undefined) {
      dto.tagIds = options.tags
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    await create(dto);
  }
}
