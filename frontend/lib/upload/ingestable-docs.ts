/** MIME types the backend auto-ingests into the `documents` collection (mirrors
 *  api document-ingest.constants.ts). Browsers sometimes give .md an empty type,
 *  so isIngestableDoc also checks the filename extension. */
export const INGESTABLE_DOC_MIMES: ReadonlySet<string> = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
])

const INGESTABLE_EXTS = ['.pdf', '.docx', '.md', '.markdown', '.txt']

/** The `accept` attribute for a doc file picker. */
export const DOC_ACCEPT =
  '.pdf,.docx,.md,.markdown,.txt,' +
  'application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'text/markdown,text/plain'

export function isIngestableDoc(file: File): boolean {
  if (file.type && INGESTABLE_DOC_MIMES.has(file.type)) return true
  const name = file.name.toLowerCase()
  return INGESTABLE_EXTS.some((ext) => name.endsWith(ext))
}

/** Split files into ingestable docs vs. the rest. */
export function partitionIngestable(files: File[]): { accepted: File[]; rejected: File[] } {
  const accepted: File[] = []
  const rejected: File[] = []
  for (const f of files) (isIngestableDoc(f) ? accepted : rejected).push(f)
  return { accepted, rejected }
}
