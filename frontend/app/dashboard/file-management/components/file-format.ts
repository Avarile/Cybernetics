import {
  Archive02Icon, File01Icon, FileZipIcon, Image01Icon,
} from '@hugeicons/core-free-icons'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'application/zip': 'ZIP',
  'text/plain': 'TXT',
  'text/csv': 'CSV',
  'application/json': 'JSON',
}

export function mimeLabel(mime: string): string {
  if (MIME_LABELS[mime]) return MIME_LABELS[mime]
  const sub = mime.split('/')[1]
  return sub ? sub : mime
}

export function mimeIconFor(mime: string): typeof File01Icon {
  if (mime.startsWith('image/')) return Image01Icon
  if (mime === 'application/zip' || mime.includes('zip')) return FileZipIcon
  if (mime.includes('tar') || mime.includes('compressed')) return Archive02Icon
  return File01Icon
}

export function quarantineReason(metadata: Record<string, unknown>): string | null {
  const reason = metadata?.quarantineReason
  return typeof reason === 'string' ? reason : null
}
