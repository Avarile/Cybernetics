import type { EditorDocument } from '../../core/editor/frontmatter';
import { buildTemplate, templateFields } from '../../core/editor/template';
import { schemas } from '../../generated/schemas';

export type TagScope = 'knowledge' | 'contact' | 'project' | 'task' | 'shared';

/** `PublicTag`, `TagService.toPublic()` in api/src/features/shared/tag.service.ts. */
export interface TagRecord {
  id: string;
  key: string;
  label: string;
  scope: TagScope;
  color: string | null;
  description: string | null;
  usageCount: number;
  isSystem: boolean;
}

/** `GET /tags` response envelope. */
export interface TagListEnvelope {
  data: TagRecord[];
  total: number;
  page: number;
  limit: number;
}

/** `UpdateTagDto`'s schema, unmodified. `key` and `scope` are absent — neither is changeable after creation. */
export const TAGS_EDIT_SCHEMA: unknown = schemas['UpdateTagDto'];

/** `CreateTagDto`'s schema, unmodified. */
export const TAGS_CREATE_SCHEMA: unknown = schemas['CreateTagDto'];

export const TAGS_EDIT_TEMPLATE_HEADER = ['key and scope cannot be changed after creation.'];

/** The record's fields as `buildTemplate`'s `current` option, keyed the same as `TAGS_EDIT_SCHEMA`. */
function toEditableFields(record: TagRecord): Record<string, unknown> {
  return {
    label: record.label,
    color: record.color,
    description: record.description,
  };
}

/**
 * Builds the frontmatter document for `record`, the same buffer `edit` opens
 * pre-filled with.
 */
export function buildTagDocument(record: TagRecord): string {
  return buildTemplate({
    schema: TAGS_EDIT_SCHEMA,
    current: toEditableFields(record),
    header: TAGS_EDIT_TEMPLATE_HEADER,
  });
}

/** Diffs the submitted document against the fetched record, field by field, returning only what changed. */
export function buildTagPatch(record: TagRecord, doc: EditorDocument): Record<string, unknown> {
  const fields = templateFields(TAGS_EDIT_SCHEMA);
  const before = toEditableFields(record);
  const patch: Record<string, unknown> = {};

  for (const key of fields) {
    const beforeValue = before[key] ?? null;
    const afterValue = key in doc.fields ? doc.fields[key] : null;

    if (JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)) {
      patch[key] = key in doc.fields ? doc.fields[key] : null;
    }
  }

  return patch;
}

/** Shared `{ data, total, page, limit }` pagination-note implementation — see `core/render/pagination-note.ts`. */
export { morePagesNote } from '../../core/render/pagination-note';
