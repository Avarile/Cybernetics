'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, RefreshIcon, Delete02Icon, SearchIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'

const ALL_TYPES = '__all__'
const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'application/pdf', label: 'PDF' },
  { value: 'image/png', label: 'PNG' },
  { value: 'image/jpeg', label: 'JPEG' },
  { value: 'image/gif', label: 'GIF' },
  { value: 'application/zip', label: 'ZIP' },
  { value: 'text/csv', label: 'CSV' },
  { value: 'application/json', label: 'JSON' },
]

export function FileToolbar({ onRefresh }: { onRefresh: () => void }) {
  const nameFilter = useFileManagementStore((s) => s.nameFilter)
  const setNameFilter = useFileManagementStore((s) => s.setNameFilter)
  const mimeType = useFileManagementStore((s) => s.mimeType)
  const setMimeType = useFileManagementStore((s) => s.setMimeType)
  const selection = useFileManagementStore((s) => s.selection)
  const requestDelete = useFileManagementStore((s) => s.requestDelete)
  const openUpload = useFileManagementStore((s) => s.openUpload)

  const selectedIds = Object.keys(selection)

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
      <Select
        value={mimeType ?? ALL_TYPES}
        onValueChange={(v) => setMimeType(v === ALL_TYPES ? undefined : v)}
      >
        <SelectTrigger className="w-40" size="sm">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <div className="relative">
        <HugeiconsIcon
          icon={SearchIcon}
          strokeWidth={2}
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="Filter this page by name…"
          className="h-8 w-56 pl-8"
          aria-label="Filter files by name"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {selectedIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => requestDelete(selectedIds)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Delete ({selectedIds.length})
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
          Refresh
        </Button>
        <Button size="sm" onClick={openUpload}>
          <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
          Upload
        </Button>
      </div>
    </div>
  )
}
