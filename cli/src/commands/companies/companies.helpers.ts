import type { EditorDocument } from '../../core/editor/frontmatter';
import { buildTemplate, templateFields } from '../../core/editor/template';
import { schemas } from '../../generated/schemas';

/**
 * `ContactCompanyRow` (api/src/infrastructure/database/schema/contact.schema.ts).
 * `ContactCompanyService.list`/`.get` return the raw row, not a projection,
 * so more columns exist (`address`, `metadata`, `logoFileId`, `isDeleted`,
 * `deletedAt`) than are modelled here — they're never rendered or edited
 * through this CLI, so there's nothing to gain from typing them.
 */
export interface CompanyRecord {
  id: string;
  name: string;
  legalName: string | null;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  phone: string | null;
  country: string | null;
  parentCompanyId: string | null;
  ownerUserId: string | null;
  status: string;
  description: string | null;
  taxNumber: string | null;
  createdAt: string;
}

/** `GET /companies` response envelope. */
export interface CompanyListEnvelope {
  data: CompanyRecord[];
  total: number;
  page: number;
  limit: number;
}

/** `UpdateCompanyDto`'s schema, unmodified. */
export const COMPANIES_EDIT_SCHEMA: unknown = schemas['UpdateCompanyDto'];

/** `CreateCompanyDto`'s schema, unmodified. */
export const COMPANIES_CREATE_SCHEMA: unknown = schemas['CreateCompanyDto'];

/** The record's fields as `buildTemplate`'s `current` option, keyed the same as `COMPANIES_EDIT_SCHEMA`. */
function toEditableFields(record: CompanyRecord): Record<string, unknown> {
  return {
    name: record.name,
    legalName: record.legalName,
    domain: record.domain,
    industry: record.industry,
    size: record.size,
    website: record.website,
    phone: record.phone,
    country: record.country,
    parentCompanyId: record.parentCompanyId,
    status: record.status,
    description: record.description,
    taxNumber: record.taxNumber,
  };
}

/**
 * Builds the frontmatter document for `record`: the same buffer `edit` opens
 * pre-filled, so `get` (which just prints this) and `edit` show the same shape.
 */
export function buildCompanyDocument(record: CompanyRecord): string {
  return buildTemplate({
    schema: COMPANIES_EDIT_SCHEMA,
    current: toEditableFields(record),
  });
}

/** Diffs the submitted document against the fetched record, field by field, returning only what changed. */
export function buildCompanyPatch(record: CompanyRecord, doc: EditorDocument): Record<string, unknown> {
  const fields = templateFields(COMPANIES_EDIT_SCHEMA);
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
