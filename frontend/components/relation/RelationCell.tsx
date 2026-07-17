'use client'

import type { IRelationRef } from '@/lib/interfaces/shared.interface'

interface RelationCellProps {
  items?: IRelationRef[] | null
  max?: number
}

/**
 * Compact read-only cell for relation arrays in data tables.
 * Shows up to `max` name pills, then a "+N more" overflow badge.
 */
export function RelationCell({ items, max = 2 }: RelationCellProps) {
  if (!items || items.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }

  const visible = items.slice(0, max)
  const overflow = items.length - max

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((item) => (
        <span
          key={item.slug}
          className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
        >
          {item.displayName}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          +{overflow}
        </span>
      )}
    </div>
  )
}
