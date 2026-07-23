import type { FieldSpec } from '../../infrastructure/database/schema/search.schema';

export const DOCUMENTS_COLLECTION = 'documents';
export const INGEST_DOCUMENT_QUEUE = 'document-ingest';
export const INGEST_DOCUMENT_JOB = 'ingest-document';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MARKDOWN_MIME = 'text/markdown';
export const PLAIN_TEXT_MIME = 'text/plain';

const INGESTABLE = new Set<string>([
  PDF_MIME,
  DOCX_MIME,
  MARKDOWN_MIME,
  PLAIN_TEXT_MIME,
]);

/** True when an uploaded file's MIME should be extracted into a text record. */
export function isIngestableDocMime(mime: string): boolean {
  return INGESTABLE.has(mime);
}

/**
 * Field spec for the `documents` collection. `createdAt`/`updatedAt`/`externalId`
 * are auto-managed by the search-service, so they are intentionally omitted.
 * Scoping is by `ownerUserId`; `conversationId` is stored for provenance/future use.
 */
export function documentsCollectionFields(): FieldSpec[] {
  return [
    { name: 'title', type: 'string', searchable: true },
    { name: 'text', type: 'string', searchable: true },
    { name: 'fileId', type: 'string', filterable: true },
    { name: 'mimeType', type: 'string', filterable: true },
    { name: 'ownerUserId', type: 'string', filterable: true },
    { name: 'conversationId', type: 'string', filterable: true },
  ];
}
