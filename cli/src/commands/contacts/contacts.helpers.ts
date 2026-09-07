import { buildTemplate, templateFields } from '../../core/editor/template';
import type { EditorDocument } from '../../core/editor/frontmatter';
import { resolveKeyBackedValue } from '../../core/resolve/key-backed-submit';
import { KEY_BACKED_FIELDS, type VocabularyIndex } from '../../core/resolve/vocabulary';
import { schemas } from '../../generated/schemas';
import type { VocabConfig } from '../vocabulary/vocabulary-crud';

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
 * Resolves `record`'s key-backed ids (`typeId`, `categoryId`, `tagIds`,
 * `companyId`) to the keys the buffer renders, via the shared
 * `VocabularyIndex` (Task 1) -- `toKey`/`toKeys` never throw, falling back
 * to the raw id when it doesn't resolve (a record pointing at a deleted
 * vocabulary row must still be editable). Keyed by *buffer* name
 * (`type`/`category`/`tags`/`company`), ready to spread into
 * `buildTemplate`'s `current` and to serve as `buildContactPatch`'s "before"
 * snapshot -- computed once by the caller (`contacts-get`/`-edit.command.ts`)
 * and passed to both, so a company (never cached by `VocabularyIndex`) is
 * fetched once per invocation, not once per call site.
 */
export async function resolveContactKeyBacked(
  record: ContactRecord,
  vocab: VocabularyIndex,
): Promise<Record<string, unknown>> {
  const raw = record as unknown as Record<string, unknown>;
  const resolved: Record<string, unknown> = {};

  for (const field of KEY_BACKED_FIELDS.contact) {
    const value = raw[field.dtoField];
    if (field.many) {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      resolved[field.bufferField] = ids.length > 0 ? await vocab.toKeys(field, ids) : [];
    } else {
      resolved[field.bufferField] = value ? await vocab.toKey(field, value as string) : null;
    }
  }

  return resolved;
}

/**
 * Builds the frontmatter document for `record`: the same buffer `edit` opens
 * pre-filled, so `get` (which just prints this) and `edit` show the same
 * shape.
 *
 * `keyBackedCurrent` is `resolveContactKeyBacked`'s output -- already
 * resolved to keys, buffer-named. This function stays synchronous:
 * `buildTemplate` (Task 4) does no HTTP and reads `current[bufferField]`
 * directly, so all the async resolution work happens once, before this is
 * called, not on every render.
 */
export function buildContactDocument(record: ContactRecord, keyBackedCurrent: Record<string, unknown>): string {
  return buildTemplate({
    schema: CONTACTS_EDIT_SCHEMA,
    current: { ...toEditableFields(record), ...keyBackedCurrent },
    bodyField: 'notes',
    header: CONTACTS_TEMPLATE_HEADER,
    keyBacked: KEY_BACKED_FIELDS.contact,
  });
}

/**
 * Diffs the submitted document against the fetched record, field by field,
 * and returns only what changed — never the whole record. Key-backed fields
 * are compared at the *buffer* level (against `keyBackedCurrent`, the same
 * values the buffer was rendered with) so an untouched field costs no
 * resolution call at all; only a field the user actually edited is resolved
 * to an id via `vocab`, and a bad key there surfaces as an `ApiError`
 * (`resolveKeyBackedValue`, `core/resolve/key-backed-submit.ts`) rather than
 * a bare `UsageError` that would kill the command.
 *
 * Unlike knowledge, no field here ever carries `format: 'date-time'` in the
 * generated schema (`birthday`/`nextFollowUpAt` come from `z.coerce.date()`,
 * which codegens to an empty `{}` schema — confirmed against
 * `src/generated/schemas.ts`), so there is no date-time-specific
 * before/after normalization to mirror from `knowledge.helpers.ts`: a plain
 * `JSON.stringify` comparison is all either domain's diff actually exercises.
 */
export async function buildContactPatch(
  record: ContactRecord,
  doc: EditorDocument,
  keyBackedCurrent: Record<string, unknown>,
  vocab: VocabularyIndex,
): Promise<Record<string, unknown>> {
  const fields = templateFields(CONTACTS_EDIT_SCHEMA, 'notes', KEY_BACKED_FIELDS.contact).filter(
    (key) => key !== 'notes',
  );
  const keyBackedByBuffer = new Map(KEY_BACKED_FIELDS.contact.map((field) => [field.bufferField, field]));

  const before = toEditableFields(record);
  const patch: Record<string, unknown> = {};

  for (const key of fields) {
    const keyBackedField = keyBackedByBuffer.get(key);

    if (keyBackedField) {
      const emptyValue = keyBackedField.many ? [] : null;
      const beforeValue = keyBackedCurrent[key] ?? emptyValue;
      const afterValue = key in doc.fields ? doc.fields[key] : emptyValue;

      if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
        patch[keyBackedField.dtoField] = await resolveKeyBackedValue(keyBackedField, afterValue, vocab);
      }
      continue;
    }

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

/**
 * `contacts type`'s config for the shared vocabulary CRUD implementation
 * (`src/commands/vocabulary/vocabulary-crud.ts`) — see `contacts-type.command.ts`.
 */
export const CONTACT_TYPE_VOCAB_CONFIG: VocabConfig = {
  label: 'contact type',
  basePath: '/contact-vocabulary/types',
  createSchema: schemas['CreateContactTypeDto'],
  updateSchema: schemas['UpdateContactTypeDto'],
};

/** `contacts category`'s config — see `contacts-category.command.ts`. */
export const CONTACT_CATEGORY_VOCAB_CONFIG: VocabConfig = {
  label: 'contact category',
  basePath: '/contact-vocabulary/categories',
  createSchema: schemas['CreateCategoryDto'],
  updateSchema: schemas['UpdateCategoryDto'],
  header: [
    'parentId nests this category under another; omit it for a root category.',
    'Categories nest at most 5 deep, and a move that would create a cycle is rejected.',
  ],
};
