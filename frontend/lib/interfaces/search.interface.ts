export type FieldType = 'string' | 'number' | 'boolean' | 'date' | 'string[]' | 'number[]'

/** One field in a collection definition (mirror of the backend FieldSpec). */
export interface FieldSpec {
  name: string
  type: FieldType
  required?: boolean
  searchable?: boolean
  filterable?: boolean
  sortable?: boolean
  enum?: (string | number)[]
}

/** GET /search/collections and GET /search/collections/:name */
export interface CollectionView {
  name: string
  displayName: string
  description: string | null
  fields: FieldSpec[]
  createdAt: string
  updatedAt: string
}

export type FilterValue = string | number | boolean | (string | number)[]
export type SortDir = 'asc' | 'desc'
export interface SortSpec { field: string; dir: SortDir }

/** Normalized query state held in the store. */
export interface SearchQuery {
  q: string
  page: number
  limit: number
  filters: Record<string, FilterValue>
  sort: SortSpec[]
}

/** Wire body POSTed to /search/collections/:name/query. */
export interface SearchRequestBody {
  q?: string
  page?: number
  limit?: number
  filters?: Record<string, FilterValue>
  sort?: string[]
}

export type RecordDocument = Record<string, unknown>

/** A single search hit: system fields + the persisted document fields. */
export type RecordHit = {
  id: string
  externalId?: string
  createdAt?: number
  updatedAt?: number
} & RecordDocument

export interface SearchResults<T = RecordHit> {
  hits: T[]
  page: number
  limit: number
  totalHits: number
  totalPages: number
  facetDistribution?: Record<string, Record<string, number>>
  processingTimeMs: number
}

export interface PersistRecordInput {
  externalId?: string
  document: RecordDocument
}

export type IndexState = 'PENDING' | 'INDEXED' | 'FAILED'
export interface PersistResult {
  id: string
  externalId: string | null
  indexState: IndexState
}

/** GET /search/collections/:name/records/:id — Postgres read (document nested). */
export interface RecordDetail {
  id: string
  externalId: string | null
  document: RecordDocument
  indexState: IndexState
  indexError?: string | null
  createdAt: string
  updatedAt: string
}

// ── Files (presigned upload) ────────────────────────────────────────
export interface InitiateUploadInput {
  filename: string
  mimeType: string
  size: number
  sha256?: string
  metadata?: Record<string, unknown>
}
export interface PresignedTarget {
  url: string
  fields?: Record<string, string>
  expiresIn: number
}
export interface InitiateUploadResult {
  fileId: string
  deduplicated: boolean
  upload?: PresignedTarget
}
export interface FileMetadata {
  id: string
  ownerId: string | null
  filename: string
  mimeType: string
  size: number
  checksumSha256: string | null
  status: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
