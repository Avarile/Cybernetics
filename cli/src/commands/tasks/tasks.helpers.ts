import type { EditorDocument } from '../../core/editor/frontmatter';
import { buildTemplate, templateFields } from '../../core/editor/template';
import type { ApiClient } from '../../core/http/api.client';
import { schemas } from '../../generated/schemas';

/**
 * `GET /tasks/{id}` response shape (`TaskRow` in
 * api/src/infrastructure/database/schema/project.schema.ts).
 *
 * Unlike contacts/projects, `TaskService` (task.service.ts) returns the raw
 * DB row directly — there is no `PublicTask` projection — so `isDeleted` and
 * `deletedAt` really are response fields, not something hidden here. The
 * flip side of "no projection": `tagIds` is accepted by `Create`/
 * `UpdateTaskDto` but has no column on `tasks` at all (tags live in a
 * separate `task_tags` join table `TaskRow` never surfaces), so a fetched
 * record never carries the tags actually set on it — editing can add tags
 * but never observe or clear the existing set through this address.
 */
export interface TaskRecord {
  id: string;
  projectId: string;
  milestoneId: string | null;
  parentTaskId: string | null;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigneeUserId: string | null;
  reporterUserId: string | null;
  estimateMinutes: number | null;
  spentMinutes: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  blockedReason: string | null;
  sortRank: string | null;
  externalRef: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/** `GET /tasks` response envelope. */
export interface TaskListEnvelope {
  data: TaskRecord[];
  total: number;
  page: number;
  limit: number;
}

/** The facts the generated schema comments can't carry, shown above every task buffer. */
export const TASKS_TEMPLATE_HEADER = [
  'startDate / dueDate are dates: YYYY-MM-DD, or a full timestamp (YYYY-MM-DDTHH:MM:SSZ).',
  'tagIds is accepted here but GET never returns it (tags live in a separate join table not ' +
    'surfaced on the task row) — editing can set tags but not show or clear the existing set.',
  "Everything below the closing --- becomes the task's description.",
];

/** `UpdateTaskDto`'s schema, unmodified — like contacts/projects, there is no `expectedVersion` to strip. */
export const TASKS_EDIT_SCHEMA: unknown = schemas['UpdateTaskDto'];

/** `CreateTaskDto`'s schema, unmodified. */
export const TASKS_CREATE_SCHEMA: unknown = schemas['CreateTaskDto'];

/** The record's fields as `buildTemplate`'s `current` option, keyed the same as `TASKS_EDIT_SCHEMA`. */
function toEditableFields(record: TaskRecord): Record<string, unknown> {
  return {
    title: record.title,
    description: record.description,
    status: record.status,
    priority: record.priority,
    assigneeUserId: record.assigneeUserId,
    milestoneId: record.milestoneId,
    estimateMinutes: record.estimateMinutes,
    startDate: record.startDate,
    dueDate: record.dueDate,
    blockedReason: record.blockedReason,
    // Never present on a fetched record — see the TaskRecord doc comment.
    tagIds: [],
  };
}

/** Builds the frontmatter document for `record` — the same buffer `edit` opens pre-filled. */
export function buildTaskDocument(record: TaskRecord): string {
  return buildTemplate({
    schema: TASKS_EDIT_SCHEMA,
    current: toEditableFields(record),
    bodyField: 'description',
    header: TASKS_TEMPLATE_HEADER,
  });
}

/**
 * Diffs the submitted document against the fetched record, field by field,
 * and returns only what changed — never the whole record.
 *
 * As with contacts/projects, no field here ever carries `format: 'date-time'`
 * in the generated schema (`startDate`/`dueDate` come from `z.coerce.date()`,
 * which codegens to an empty `{}` schema), so a plain `JSON.stringify`
 * comparison is all this diff needs.
 */
export function buildTaskPatch(record: TaskRecord, doc: EditorDocument): Record<string, unknown> {
  const fields = templateFields(TASKS_EDIT_SCHEMA, 'description').filter((key) => key !== 'description');

  const before = toEditableFields(record);
  const patch: Record<string, unknown> = {};

  for (const key of fields) {
    const beforeValue = before[key] ?? null;
    const afterValue = key in doc.fields ? doc.fields[key] : null;

    if (JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)) {
      patch[key] = key in doc.fields ? doc.fields[key] : null;
    }
  }

  const bodyBefore = typeof before.description === 'string' ? before.description : '';
  if (doc.body !== bodyBefore) {
    patch.description = doc.body;
  }

  return patch;
}

/**
 * `TaskRepository.list` bakes every filter — including the `projectIds`
 * visibility narrowing applied when no explicit `--project` is given — into
 * the same `where` clause that produces `total` (see task.repository.ts), so
 * `total` is already the access-scoped count. See
 * `core/render/pagination-note.ts` for the shared implementation this
 * re-exports.
 */
export { morePagesNote } from '../../core/render/pagination-note';

/**
 * Resolves each distinct `projectId` in `ids` to its project `key`, for
 * rendering `tasks ls`'s `REF` (`KEY-NUMBER`) column.
 *
 * `TaskRow` carries only `projectId` (see the TaskRecord doc comment) — no
 * project key — so `REF` cannot be built from the tasks payload alone.
 * `GET /projects/{id}` is available to any `user`-role caller (unlike
 * `GET /users/{id}`, which is admin-only — see the note on ASSIGNEE in
 * tasks-ls.command.ts), so resolving it here is safe for ordinary accounts.
 *
 * Deduplicated and fetched once per distinct id (`Promise.all`, not one call
 * per row), so a page of tasks from a handful of projects costs a handful of
 * requests, not one per row.
 */
export async function resolveProjectKeys(
  projectIds: readonly string[],
  client: ApiClient,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(projectIds));
  const entries = await Promise.all(
    unique.map(async (id): Promise<[string, string]> => {
      const project = await client.get<{ key: string }>(`/projects/${id}`);
      return [id, project.key];
    }),
  );
  return new Map(entries);
}
