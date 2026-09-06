import type { ApiClient } from "@/lib/api/client"

/** Mirrors `PresignedTarget` in `api/src/infrastructure/file-manage/object-storage.interface.ts`. */
export interface PresignedTarget {
  url: string
  /** POST-policy form fields. Must be appended BEFORE the file. */
  fields?: Record<string, string>
  expiresIn: number
}

/** Mirrors `InitiateResult` in `file.service.ts`. */
export interface InitiateResult {
  fileId: string
  /**
   * True when the content was already stored under the same SHA-256. There is
   * then NO `upload` target, and both the PUT and the complete call must be
   * skipped — the file is already available.
   */
  deduplicated: boolean
  upload?: PresignedTarget
}

/** Mirrors `FileMetadata` in `file.types.ts`. */
export interface FileMetadata {
  id: string
  ownerId: string | null
  filename: string
  mimeType: string
  size: number
  checksumSha256: string | null
  status: "PENDING" | "AVAILABLE" | "QUARANTINED"
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/**
 * MIME types `document-ingest` will extract into text records.
 *
 * Copied from `document-ingest.constants.ts`. Other types can still be stored,
 * they just never become searchable text — the dropzone says so per file
 * rather than silently accepting something that never gets indexed.
 */
export const INGESTABLE_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
] as const

export function isIngestable(mime: string): boolean {
  return (INGESTABLE_MIMES as readonly string[]).includes(mime)
}

/** Files at or above this are hashed in a worker rather than on the main thread. */
export const HASH_INLINE_LIMIT = 8 * 1024 * 1024

export type UploadPhase =
  | "queued"
  | "hashing"
  | "uploading"
  | "completing"
  | "processing"
  | "indexed"
  | "failed"

export interface UploadProgress {
  phase: UploadPhase
  /** 0..100 while uploading. */
  percent: number
  fileId?: string
  error?: string
  deduplicated?: boolean
}

/** Hex SHA-256 of a file, via WebCrypto. */
export async function sha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digest = await crypto.subtle.digest("SHA-256", buffer)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Uploads the file body to a presigned target.
 *
 * This is a multipart **POST policy**, not a PUT: `initiateUpload` calls
 * `presignedPostPolicy`, so the response carries form `fields` that must be
 * appended before the file part. Sending a bare PUT body fails the policy.
 *
 * XMLHttpRequest rather than fetch, because fetch still has no upload progress
 * event.
 */
export function postToPresignedTarget(
  target: PresignedTarget,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    // Order matters: S3/MinIO POST policies require every field before `file`.
    for (const [k, v] of Object.entries(target.fields ?? {})) form.append(k, v)
    form.append("file", file)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", target.url, true)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload rejected by storage (${xhr.status})`))
    xhr.onerror = () => reject(new Error("Upload failed"))
    xhr.onabort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))

    signal?.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

export interface UploadOptions {
  client: ApiClient
  file: File
  onProgress: (p: UploadProgress) => void
  signal?: AbortSignal
  /** Poll budget for PENDING → AVAILABLE. */
  pollTimeoutMs?: number
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Drives one file through the whole pipeline:
 *
 *   POST /files            → presigned target (or a dedup short-circuit)
 *   POST <target.url>      → multipart form, straight to MinIO
 *   POST /files/:id/complete
 *   poll GET /files/:id    → until AVAILABLE
 */
export async function uploadFile(opts: UploadOptions): Promise<FileMetadata | null> {
  const { client, file, onProgress, signal } = opts
  const sleep = opts.sleep ?? defaultSleep
  const budget = opts.pollTimeoutMs ?? 120_000

  const emit = (p: Partial<UploadProgress>) =>
    onProgress({ phase: "queued", percent: 0, ...p } as UploadProgress)

  try {
    emit({ phase: "hashing" })
    // Worth the cost: it enables the dedup short-circuit, and completeUpload
    // verifies the value we send.
    const sha256 = await sha256Hex(file)

    const initiated = await client.post<InitiateResult>("/files", {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      sha256,
    })

    // Dedup: the content is already stored and AVAILABLE. Skip BOTH the upload
    // and the complete call — treating the missing `upload` key as an error
    // would break every re-upload.
    if (initiated.deduplicated || !initiated.upload) {
      emit({ phase: "processing", percent: 100, fileId: initiated.fileId, deduplicated: true })
      const meta = await pollUntilAvailable(client, initiated.fileId, budget, sleep, signal)
      emit({
        phase: meta ? "indexed" : "failed",
        percent: 100,
        fileId: initiated.fileId,
        deduplicated: true,
        error: meta ? undefined : "Timed out waiting for processing",
      })
      return meta
    }

    emit({ phase: "uploading", percent: 0, fileId: initiated.fileId })
    await postToPresignedTarget(
      initiated.upload,
      file,
      (percent) => emit({ phase: "uploading", percent, fileId: initiated.fileId }),
      signal,
    )

    emit({ phase: "completing", percent: 100, fileId: initiated.fileId })
    await client.post(`/files/${initiated.fileId}/complete`, { sha256 })

    emit({ phase: "processing", percent: 100, fileId: initiated.fileId })
    const meta = await pollUntilAvailable(client, initiated.fileId, budget, sleep, signal)
    emit({
      phase: meta ? "indexed" : "failed",
      percent: 100,
      fileId: initiated.fileId,
      error: meta ? undefined : "Timed out waiting for processing",
    })
    return meta
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      emit({ phase: "failed", percent: 0, error: "Cancelled" })
      return null
    }
    emit({
      phase: "failed",
      percent: 0,
      error: err instanceof Error ? err.message : "Upload failed",
    })
    return null
  }
}

/** Backoff 1s → 2s → 4s, capped at 10s, until the budget runs out. */
export async function pollUntilAvailable(
  client: ApiClient,
  fileId: string,
  budgetMs: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<FileMetadata | null> {
  let waited = 0
  let delay = 1000

  for (;;) {
    if (signal?.aborted) return null
    const meta = await client.get<FileMetadata>(`/files/${fileId}`)
    if (meta.status === "AVAILABLE") return meta
    // QUARANTINED is terminal — the magic-byte check rejected it.
    if (meta.status === "QUARANTINED") {
      throw new Error("File was quarantined during processing")
    }
    if (waited >= budgetMs) return null
    await sleep(delay)
    waited += delay
    delay = Math.min(delay * 2, 10_000)
  }
}
