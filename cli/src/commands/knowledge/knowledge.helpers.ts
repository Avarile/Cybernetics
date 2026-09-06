import { buildTemplate, templateFields } from '../../core/editor/template';
import type { EditorDocument } from '../../core/editor/frontmatter';
import { schemas } from '../../generated/schemas';

/**
 * Ordinary pagination beyond this page — same fact every other domain
 * reports, unrelated to `withheldRowsNote` below (which reports rows an
 * access filter dropped *from* this page, not rows that exist on a later
 * one). See `core/render/pagination-note.ts` for the shared implementation
 * this re-exports.
 */
export { morePagesNote } from '../../core/render/pagination-note';

/**
 * `GET /knowledge/{id}` response shape (`PublicKnowledge` in
 * api/src/features/knowledge/knowledge.service.ts). There is no generated
 * schema for it — only request DTOs are codegen'd — so it's hand-typed here.
 *
 * Notably absent: `expiresAt`. The column exists on the row, and both
 * `CreateKnowledgeDto`/`UpdateKnowledgeDto` accept it, but the service's
 * `toPublic()` projection never includes it in a response. That's a real gap
 * in the API, not something fixable from the CLI — its practical effect is
 * that `expiresAt` always renders empty in `get`/`edit`, even when a value is
 * set server-side, and editing it can only ever set a new value, never
 * observe or clear an existing one through this address.
 */
export interface KnowledgeRecord {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string | null;
  format: string;
  status: string;
  visibility: string;
  version: number;
  typeId: string | null;
  categoryId: string | null;
  ownerUserId: string | null;
  sourceUrl: string | null;
  sourceFileId: string | null;
  language: string;
  publishedAt: string | null;
  reviewDueAt: string | null;
  tagIds: string[];
  access: string;
  updatedAt: string;
}

/** `GET /knowledge` response envelope. */
export interface KnowledgeListEnvelope {
  data: KnowledgeRecord[];
  total: number;
  /**
   * Count of rows matching the filters before per-row access resolution.
   * `KnowledgeRepository.list` fetches one page of `limit` rows and the
   * service then drops any the caller can't read, so `data.length` can be
   * smaller than `limit` either because the page ran out of data or because
   * some of it was access-filtered. Comparing against this field is what
   * tells the two apart — see `withheldRowsNote`.
   */
  totalBeforeAccess?: number;
  page: number;
  limit: number;
}

/** Two facts the generated schema comments can't carry, shown above every buffer. */
export const KNOWLEDGE_TEMPLATE_HEADER = [
  'reviewDueAt / expiresAt are dates: YYYY-MM-DD, or a full timestamp (YYYY-MM-DDTHH:MM:SSZ).',
  'Everything below the closing --- becomes the record body.',
];

interface JsonSchemaLike {
  properties?: Record<string, { format?: string } | undefined>;
  required?: string[];
}

function withoutExpectedVersion(schema: unknown): JsonSchemaLike {
  const raw = (schema ?? {}) as JsonSchemaLike;
  const { expectedVersion: _expectedVersion, ...rest } = raw.properties ?? {};
  return { ...raw, properties: rest };
}

/**
 * `UpdateKnowledgeDto`'s schema minus `expectedVersion`. That field exists in
 * the DTO purely for optimistic concurrency (see `buildKnowledgePatch`) — the
 * CLI sets it from the fetched record's `version`, it is never something the
 * user edits in the buffer, so it must not appear as a frontmatter field.
 * template.ts can't be modified for this task, so the exclusion happens here,
 * on the schema this module passes in, rather than in `buildTemplate` itself.
 */
export const KNOWLEDGE_EDIT_SCHEMA: unknown = withoutExpectedVersion(
  schemas['UpdateKnowledgeDto'],
);

/** `CreateKnowledgeDto`'s schema, unmodified — it has no `expectedVersion` to strip. */
export const KNOWLEDGE_CREATE_SCHEMA: unknown = schemas['CreateKnowledgeDto'];

/**
 * Mirrors template.ts's private date-time formatting (not exported, and
 * template.ts is out of bounds for this task) so a fetched record's date
 * fields can be compared, on equal footing, against what the user's edited
 * buffer contains. Keep in sync with `formatDateTimeValue` in
 * `src/core/editor/template.ts` by hand.
 */
function normalizeDateTimeForCompare(raw: unknown): unknown {
  if (raw === null || raw === undefined) return raw;
  const date = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(date.getTime())) return raw;
  const iso = date.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso;
}

/** The record's fields as `buildTemplate`'s `current` option, keyed the same as `KNOWLEDGE_EDIT_SCHEMA`. */
function toEditableFields(record: KnowledgeRecord): Record<string, unknown> {
  return {
    title: record.title,
    summary: record.summary,
    body: record.body,
    format: record.format,
    typeId: record.typeId,
    categoryId: record.categoryId,
    visibility: record.visibility,
    ownerUserId: record.ownerUserId,
    sourceUrl: record.sourceUrl,
    language: record.language,
    reviewDueAt: record.reviewDueAt,
    // Never present on a fetched record — see the KnowledgeRecord doc comment.
    expiresAt: null,
    tagIds: record.tagIds,
  };
}

/**
 * Builds the frontmatter document for `record`: the same buffer `edit` opens
 * pre-filled, so `get` (which just prints this) and `edit` show the same
 * shape.
 */
export function buildKnowledgeDocument(record: KnowledgeRecord): string {
  return buildTemplate({
    schema: KNOWLEDGE_EDIT_SCHEMA,
    current: toEditableFields(record),
    bodyField: 'body',
    header: KNOWLEDGE_TEMPLATE_HEADER,
  });
}

/**
 * Diffs the submitted document against the fetched record, field by field,
 * and returns only what changed — never the whole record. `expectedVersion`
 * is deliberately not this function's concern: it isn't a content field, it's
 * added by the caller from `record.version` regardless of what else changed.
 */
export function buildKnowledgePatch(
  record: KnowledgeRecord,
  doc: EditorDocument,
): Record<string, unknown> {
  const schema = KNOWLEDGE_EDIT_SCHEMA as JsonSchemaLike;
  const properties = schema.properties ?? {};
  const fields = templateFields(KNOWLEDGE_EDIT_SCHEMA, 'body').filter((key) => key !== 'body');

  const before = toEditableFields(record) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const key of fields) {
    const fieldSchema = properties[key] ?? {};
    let beforeValue: unknown = before[key] ?? null;
    if (fieldSchema.format === 'date-time') {
      beforeValue = normalizeDateTimeForCompare(beforeValue);
    }
    const afterValue = key in doc.fields ? doc.fields[key] : null;

    if (JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)) {
      patch[key] = key in doc.fields ? doc.fields[key] : null;
    }
  }

  const bodyBefore = typeof record.body === 'string' ? record.body : '';
  if (doc.body !== bodyBefore) {
    patch.body = doc.body;
  }

  return patch;
}

/**
 * Announces rows withheld by access control on this page, rather than
 * silently rendering a page that looks complete but isn't. `null` when there
 * is nothing to report (no `totalBeforeAccess` in the envelope, or every
 * matching row on this page was visible).
 */
export function withheldRowsNote(envelope: KnowledgeListEnvelope): string | null {
  if (typeof envelope.totalBeforeAccess !== 'number') return null;

  const expectedOnPage = Math.max(
    0,
    Math.min(envelope.limit, envelope.totalBeforeAccess - (envelope.page - 1) * envelope.limit),
  );
  const withheld = expectedOnPage - envelope.data.length;
  if (withheld <= 0) return null;

  return (
    `${withheld} record(s) on this page exist but were withheld — ` +
    `you don't have access to view them.`
  );
}
