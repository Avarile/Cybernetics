'use client'

import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, FilterIcon, Delete02Icon, SearchIcon, Upload01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { RecordFilters } from '@/components/data-management/record-filters'
import { useCollections } from '@/lib/hooks/use-collections'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useRecordMutations } from '@/lib/hooks/use-record-mutations'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordToolbar({
  fields,
  facetDistribution,
}: {
  fields: FieldSpec[]
  facetDistribution?: Record<string, Record<string, number>>
}) {
  const isAdmin = useIsAdmin()
  const { collections } = useCollections()
  const s = useDataManagementStore()
  const openCollections = useDataManagementStore((state) => state.openCollections)
  const openUpload = useDataManagementStore((state) => state.openUpload)
  const { reindex } = useRecordMutations()
  const activeFilters = Object.keys(s.filters).length
  const selectedIds = Object.keys(s.selection)

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 lg:px-6">
      <Select value={s.collection ?? ''} onValueChange={s.setCollection}>
        <SelectTrigger className="w-56" size="sm">
          <SelectValue placeholder="Select a collection" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {collections.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.displayName}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <SearchBox value={s.q} onChange={s.setSearch} />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <HugeiconsIcon icon={FilterIcon} strokeWidth={2} />
            Filters
            {activeFilters > 0 && <Badge variant="secondary">{activeFilters}</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72">
          <RecordFilters fields={fields} facetDistribution={facetDistribution} />
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={openUpload}>
          <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} />
          Upload documents
        </Button>
        {isAdmin && selectedIds.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => s.requestDelete(selectedIds)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Delete ({selectedIds.length})
          </Button>
        )}
        {isAdmin && (<Button variant="outline" size="sm" onClick={openCollections}>Manage…</Button>)}
        {isAdmin && s.collection && (<Button variant="outline" size="sm" onClick={() => void reindex()}>Reindex</Button>)}
        {isAdmin && (
          <Button size="sm" onClick={s.openCreate} disabled={!s.collection}>
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
            New record
          </Button>
        )}
      </div>
    </div>
  )
}

/** Local draft + debounce so keystrokes don't refetch on every character. */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  React.useEffect(() => {
    const id = setTimeout(() => {
      if (draft !== value) onChange(draft)
    }, 300)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])

  return (
    <div className="relative">
      <HugeiconsIcon
        icon={SearchIcon}
        strokeWidth={2}
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        className="h-8 w-56 pl-8"
        placeholder="Search…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    </div>
  )
}
