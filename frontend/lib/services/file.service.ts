import { apiClient } from '@/lib/http/api-client'
import type {
  FileMetadata,
  InitiateUploadInput,
  InitiateUploadResult,
  PresignedTarget,
} from '@/lib/interfaces/search.interface'

export const fileService = {
  initiate(input: InitiateUploadInput): Promise<InitiateUploadResult> {
    return apiClient.post<InitiateUploadResult>('/files', input).then((r) => r.data)
  },

  /** Upload bytes straight to storage via the presigned POST policy (no bearer). */
  async uploadToPolicy(target: PresignedTarget, file: File): Promise<void> {
    const form = new FormData()
    for (const [k, v] of Object.entries(target.fields ?? {})) form.append(k, v)
    form.append('file', file) // MUST be appended last for a MinIO POST policy
    const res = await fetch(target.url, { method: 'POST', body: form })
    if (!res.ok) throw new Error(`Upload failed (${res.status})`)
  },

  complete(fileId: string, sha256?: string): Promise<FileMetadata> {
    return apiClient
      .post<FileMetadata>(`/files/${fileId}/complete`, sha256 ? { sha256 } : {})
      .then((r) => r.data)
  },

  get(id: string): Promise<FileMetadata> {
    return apiClient.get<FileMetadata>(`/files/${id}`).then((r) => r.data)
  },

  async downloadUrl(id: string, ttl?: number): Promise<string> {
    const { data } = await apiClient.get<PresignedTarget>(`/files/${id}/download-url`, {
      params: ttl ? { ttl } : undefined,
    })
    return data.url
  },
}
