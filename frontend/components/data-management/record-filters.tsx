'use client'

import { Button } from '@/components/ui/button'
import { FilterControl } from '@/components/data-management/field-to-filter'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordFilters({ fields }: { fields: FieldSpec[] }) {
  const filters = useDataManagementStore((s) => s.filters)
  const setFilter = useDataManagementStore((s) => s.setFilter)
  const clearFilters = useDataManagementStore((s) => s.clearFilters)
  const filterable = fields.filter((f) => f.filterable)

  if (filterable.length === 0) {
    return <p className="text-sm text-muted-foreground">No filterable fields in this collection.</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {filterable.map((field) => (
        <FilterControl
          key={field.name}
          field={field}
          value={filters[field.name]}
          onChange={(v) => setFilter(field.name, v)}
        />
      ))}
      <Button variant="ghost" size="sm" className="self-end" onClick={clearFilters}>
        Clear all
      </Button>
    </div>
  )
}
