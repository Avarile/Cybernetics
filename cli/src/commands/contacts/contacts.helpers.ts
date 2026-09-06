import { buildTemplate, templateFields } from '../../core/editor/template';
import type { EditorDocument } from '../../core/editor/frontmatter';
import { schemas } from '../../generated/schemas';

/**
 * `GET /contacts/{id}` response shape (`PublicContact` in
 * api/src/features/contacts/contact.service.ts). There is no generated schema
 * for it — only request DTOs are codegen'd — so it's hand-typed here.
 *
 * Notably absent: `salutation`, `address`, `timezone`, `language`, `birthday`
 * and `notes`. `Create`/`UpdateContactDto` all accept them, and the columns
 * exist on the row, but `toPublic()` never projects them onto `PublicContact`.
 * That's a real gap in the API, not something fixable from the CLI — its
 * practical effect is that these fields always render empty in `get`/`edit`,
 * even when a value is set server-side, and editing them can only ever set a
 * new value, never observe or clear an existing one through this address.
 * `notes` is this domain's body field, so the same gap means an existing
 * contact's notes can never be viewed or appended to here — only replaced.
 */
export interface ContactRecord {
  id: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  typeId: string | null;
  categoryId: string | null;
  ownerUserId: string | null;
  status: string;
  source: string;
  visibility: string;
  country: string | null;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  tagIds: string[];
  createdAt: string;
}

/** `GET /contacts` response envelope. */
export interface ContactListEnvelope {
  data: ContactRecord[];
  total: number;
  page: number;
  limit: number;
}

/** One row of `GET /contacts/{id}/channels` — a plain array, not paginated. */
export interface ContactChannelRecord {
  id: string;
  contactId: string;
  kind: string;
  value: string;
  label: string | null;
  isPrimary: boolean;
  isVerified: boolean;
  optedOutAt: string | null;
}

/** One row of `GET /contacts/{id}/interactions`. */
export interface ContactInteractionRecord {
  id: string;
  contactId: string;
  kind: string;
  occurredAt: string;
  subject: string | null;
  body: string | null;
  direction: string | null;
  projectId: string | null;
  durationMinutes: number | null;
}

/** `GET /contacts/{id}/interactions` response envelope. */
export interface ContactInteractionListEnvelope {
  data: ContactInteractionRecord[];
  total: number;
  page: number;
  limit: number;
}

/** The two facts the generated schema comments can't carry, shown above every buffer. */
export const CONTACTS_TEMPLATE_HEADER = [
  'birthday / nextFollowUpAt are dates: YYYY-MM-DD, or a full timestamp (YYYY-MM-DDTHH:MM:SSZ).',
  'salutation, address, timezone, language, birthday and notes are accepted here but never ' +
    'returned by GET — editing them can set a new value but not show or clear an existing one.',
  "Everything below the closing --- becomes the contact's notes.",
];

/** `UpdateContactDto`'s schema, unmodified — unlike knowledge, there is no `expectedVersion` to strip. */
export const CONTACTS_EDIT_SCHEMA: unknown = schemas['UpdateContactDto'];

/** `CreateContactDto`'s schema, unmodified. */
export const CONTACTS_CREATE_SCHEMA: unknown = schemas['CreateContactDto'];

/** The record's fields as `buildTemplate`'s `current` option, keyed the same as `CONTACTS_EDIT_SCHEMA`. */
function toEditableFields(record: ContactRecord): Record<string, unknown> {
  return {
    firstName: record.firstName,
    lastName: record.lastName,
    displayName: record.displayName,
    primaryEmail: record.primaryEmail,
    primaryPhone: record.primaryPhone,
    jobTitle: record.jobTitle,
    companyId: record.companyId,
    typeId: record.typeId,
    categoryId: record.categoryId,
    ownerUserId: record.ownerUserId,
    status: record.status,
    visibility: record.visibility,
    country: record.country,
    nextFollowUpAt: record.nextFollowUpAt,
    tagIds: record.tagIds,
    // Never present on a fetched record — see the ContactRecord doc comment.
    salutation: null,
    address: null,
    timezone: null,
    language: null,
    birthday: null,
    notes: null,
  };
}

/**
 * Builds the frontmatter document for `record`: the same buffer `edit` opens
 * pre-filled, so `get` (which just prints this) and `edit` show the same
 * shape.
 */
export function buildContactDocument(record: ContactRecord): string {
  return buildTemplate({
    schema: CONTACTS_EDIT_SCHEMA,
    current: toEditableFields(record),
    bodyField: 'notes',
    header: CONTACTS_TEMPLATE_HEADER,
  });
}

/**
 * Diffs the submitted document against the fetched record, field by field,
 * and returns only what changed — never the whole record.
 *
 * Unlike knowledge, no field here ever carries `format: 'date-time'` in the
 * generated schema (`birthday`/`nextFollowUpAt` come from `z.coerce.date()`,
 * which codegens to an empty `{}` schema — confirmed against
 * `src/generated/schemas.ts`), so there is no date-time-specific
 * before/after normalization to mirror from `knowledge.helpers.ts`: a plain
 * `JSON.stringify` comparison is all either domain's diff actually exercises.
 */
export function buildContactPatch(
  record: ContactRecord,
  doc: EditorDocument,
): Record<string, unknown> {
  const fields = templateFields(CONTACTS_EDIT_SCHEMA, 'notes').filter((key) => key !== 'notes');

  const before = toEditableFields(record);
  const patch: Record<string, unknown> = {};

  for (const key of fields) {
    const beforeValue = before[key] ?? null;
    const afterValue = key in doc.fields ? doc.fields[key] : null;

    if (JSON.stringify(beforeValue ?? null) !== JSON.stringify(afterValue ?? null)) {
      patch[key] = key in doc.fields ? doc.fields[key] : null;
    }
  }

  const bodyBefore = typeof before.notes === 'string' ? before.notes : '';
  if (doc.body !== bodyBefore) {
    patch.notes = doc.body;
  }

  return patch;
}

/**
 * `ContactRepository.list` bakes the `visibleTo` predicate into the same
 * `where` clause that produces `total` (see contact.repository.ts), so
 * `total` already is the access-scoped count and every row it implies is
 * genuinely on some page. The only way rows go unannounced here is ordinary
 * pagination — see `core/render/pagination-note.ts` for the shared
 * implementation this re-exports. Works unchanged for
 * `/contacts/{id}/interactions`, which returns the same envelope shape.
 */
export { morePagesNote } from '../../core/render/pagination-note';
