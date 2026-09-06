import { buildTemplate, templateFields } from '../../core/editor/template';
import type { EditorDocument } from '../../core/editor/frontmatter';
import { schemas } from '../../generated/schemas';

/**
 * `GET /projects/{id}` response shape (`PublicProject` in
 * api/src/features/projects/project.service.ts's `toPublic()`).
 *
 * Notably absent: `parentProjectId`, `budgetAmount`, `currency` and `color`.
 * `Create`/`UpdateProjectDto` all accept them and the columns exist on the
 * row, but `toPublic()` never projects them onto `PublicProject`. That's a
 * real gap in the API, not something fixable from the CLI — its practical
 * effect is that these fields always render empty in `get`/`edit`, even when
 * a value is set server-side, and editing them can only ever set a new
 * value, never observe or clear an existing one through this address.
 */
export interface ProjectRecord {
  id: string;
  key: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  visibility: string;
  ownerUserId: string | null;
  leadUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  progressPct: number;
  tagIds: string[];
  access: string;
  updatedAt: string;
}

/** `GET /projects` response envelope. */
export interface ProjectListEnvelope {
  data: ProjectRecord[];
  total: number;
  page: number;
  limit: number;
}

/**
 * One row of `GET /projects/{id}/milestones` — a plain array, not paginated
 * (`PlanningRepository.listMilestones` / `PlanningService.listMilestones`).
 *
 * Unlike `ProjectRecord`, this is the raw DB row (`MilestoneRow`), not a
 * projected DTO — `isDeleted`/`deletedAt` are real response fields, carried
 * here rather than hidden, since that's what the server actually sends.
 */
export interface MilestoneRecord {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: string;
  dueDate: string | null;
  reachedAt: string | null;
  ownerUserId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  deletedAt: string | null;
}

/** One row of `GET /projects/{id}/members`. */
export interface ProjectMemberRecord {
  id: string;
  projectId: string;
  userId: string;
  roleInProject: string;
  addedBy: string | null;
  joinedAt: string;
}

/** The facts the generated schema comments can't carry, shown above every project buffer. */
export const PROJECTS_TEMPLATE_HEADER = [
  'startDate / dueDate are dates: YYYY-MM-DD, or a full timestamp (YYYY-MM-DDTHH:MM:SSZ).',
  'parentProjectId, budgetAmount, currency and color are accepted here but never returned ' +
    'by GET — editing them can set a new value but not show or clear an existing one.',
  'tagIds is accepted here but GET never returns it either — same caveat.',
  "Everything below the closing --- becomes the project's description.",
];

/** `UpdateProjectDto`'s schema, unmodified — like contacts, there is no `expectedVersion` to strip. */
export const PROJECTS_EDIT_SCHEMA: unknown = schemas['UpdateProjectDto'];

/** `CreateProjectDto`'s schema, unmodified. */
export const PROJECTS_CREATE_SCHEMA: unknown = schemas['CreateProjectDto'];

/** `CreateMilestoneDto`'s schema, unmodified. */
export const MILESTONE_CREATE_SCHEMA: unknown = schemas['CreateMilestoneDto'];

/** `UpdateMilestoneDto`'s schema, unmodified. */
export const MILESTONE_EDIT_SCHEMA: unknown = schemas['UpdateMilestoneDto'];

/** The facts the generated schema comments can't carry, shown above every milestone edit buffer. */
export const MILESTONE_TEMPLATE_HEADER = [
  'dueDate is a date: YYYY-MM-DD, or a full timestamp (YYYY-MM-DDTHH:MM:SSZ).',
  "Everything below the closing --- becomes the milestone's description.",
];

/** The record's fields as `buildTemplate`'s `current` option, keyed the same as `PROJECTS_EDIT_SCHEMA`. */
function toEditableFields(record: ProjectRecord): Record<string, unknown> {
  return {
    name: record.name,
    description: record.description,
    status: record.status,
    priority: record.priority,
    leadUserId: record.leadUserId,
    visibility: record.visibility,
    startDate: record.startDate,
    dueDate: record.dueDate,
    tagIds: record.tagIds,
    ownerUserId: record.ownerUserId,
    // Never present on a fetched record — see the ProjectRecord doc comment.
    parentProjectId: null,
    budgetAmount: null,
    currency: null,
    color: null,
  };
}

/** Builds the frontmatter document for `record` — the same buffer `edit` opens pre-filled. */
export function buildProjectDocument(record: ProjectRecord): string {
  return buildTemplate({
    schema: PROJECTS_EDIT_SCHEMA,
    current: toEditableFields(record),
    bodyField: 'description',
    header: PROJECTS_TEMPLATE_HEADER,
  });
}

/**
 * Diffs the submitted document against the fetched record, field by field,
 * and returns only what changed — never the whole record.
 *
 * As with contacts, no field here ever carries `format: 'date-time'` in the
 * generated schema (`startDate`/`dueDate` come from `z.coerce.date()`, which
 * codegens to an empty `{}` schema — confirmed against
 * `src/generated/schemas.ts`), so a plain `JSON.stringify` comparison is all
 * this diff needs.
 */
export function buildProjectPatch(
  record: ProjectRecord,
  doc: EditorDocument,
): Record<string, unknown> {
  const fields = templateFields(PROJECTS_EDIT_SCHEMA, 'description').filter((key) => key !== 'description');

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

/** The record's fields as `buildTemplate`'s `current` option, keyed the same as `MILESTONE_EDIT_SCHEMA`. */
function toMilestoneEditableFields(record: MilestoneRecord): Record<string, unknown> {
  return {
    name: record.name,
    description: record.description,
    status: record.status,
    dueDate: record.dueDate,
    ownerUserId: record.ownerUserId,
    sortOrder: record.sortOrder,
  };
}

/** Builds the frontmatter document for `record` — the same buffer `milestone edit` opens pre-filled. */
export function buildMilestoneDocument(record: MilestoneRecord): string {
  return buildTemplate({
    schema: MILESTONE_EDIT_SCHEMA,
    current: toMilestoneEditableFields(record),
    bodyField: 'description',
    header: MILESTONE_TEMPLATE_HEADER,
  });
}

/**
 * Diffs the submitted document against the fetched milestone, field by
 * field, returning only what changed — same shape as `buildProjectPatch`.
 */
export function buildMilestonePatch(
  record: MilestoneRecord,
  doc: EditorDocument,
): Record<string, unknown> {
  const fields = templateFields(MILESTONE_EDIT_SCHEMA, 'description').filter((key) => key !== 'description');

  const before = toMilestoneEditableFields(record);
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
 * `ProjectRepository.list` bakes its `visibleTo` predicate into the same
 * `where` clause that produces `total` (see project.repository.ts), so
 * `total` is already the access-scoped count and every row it implies is
 * genuinely on some page. See `core/render/pagination-note.ts` for the
 * shared implementation this re-exports.
 */
export { morePagesNote } from '../../core/render/pagination-note';
