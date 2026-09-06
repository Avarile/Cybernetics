import { Badge } from "@/components/ui/badge"
import type { DomainTableConfig } from "@/components/data-table/types"
import { isIngestable, type FileMetadata } from "@/lib/files/upload"

export type FileRow = FileMetadata

/** From `queryFilesSchema` in `api/src/features/file-processor/dto/`. */
const STATUSES = [
  { value: "PENDING", label: "Pending" },
  { value: "AVAILABLE", label: "Available" },
  { value: "QUARANTINED", label: "Quarantined" },
]

const STATUS_VARIANT: Record<FileRow["status"], "default" | "secondary" | "destructive"> = {
  AVAILABLE: "default",
  PENDING: "secondary",
  QUARANTINED: "destructive",
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

/** Short label for a MIME type, so the column stays narrow. */
export function mimeLabel(mime: string): string {
  if (mime === "application/pdf") return "PDF"
  if (mime.endsWith("wordprocessingml.document")) return "DOCX"
  if (mime === "text/markdown") return "Markdown"
  if (mime === "text/plain") return "Text"
  if (mime.startsWith("image/")) return mime.slice(6).toUpperCase()
  return mime.split("/").pop()?.toUpperCase() ?? mime
}

export const filesConfig: DomainTableConfig<FileRow> = {
  key: "files",
  title: "Files",
  endpoint: "/files",
  // `queryFilesSchema` has no `search` param — offering a search box that the
  // API silently ignores would be worse than not having one.
  searchable: false,
  canCreate: false, // creation is the dropzone, not a form
  canEdit: false, // the API exposes no file update
  canDelete: true,
  permissions: { delete: "file.delete" },
  emptyMessage: "No files yet. Drop one above to upload it.",
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "available", label: "Available", query: { status: "AVAILABLE" } },
    { value: "pending", label: "Pending", query: { status: "PENDING" } },
    { value: "quarantined", label: "Quarantined", query: { status: "QUARANTINED" } },
  ],
  filters: [{ key: "status", label: "Status", options: STATUSES }],
  columns: [
    {
      key: "filename",
      header: "Name",
      cell: (r) => <span className="font-medium">{r.filename}</span>,
      hideable: false,
    },
    {
      key: "mimeType",
      header: "Type",
      cell: (r) => (
        <span className="flex items-center gap-1.5 text-xs">
          {mimeLabel(r.mimeType)}
          {isIngestable(r.mimeType) && (
            <Badge variant="secondary" className="text-[10px]">
              indexed
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "size",
      header: "Size",
      cell: (r) => <span className="text-xs tabular-nums">{formatBytes(r.size)}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Badge variant={STATUS_VARIANT[r.status]} className="text-xs">
          {STATUSES.find((s) => s.value === r.status)?.label ?? r.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Uploaded",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {new Date(r.createdAt).toLocaleDateString()}
        </span>
      ),
    },
  ],
}
