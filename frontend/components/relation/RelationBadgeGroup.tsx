'use client'

import { IconX } from '@tabler/icons-react'
import type { IRelationRef } from '@/lib/interfaces/shared.interface'

interface RelationBadgeGroupProps {
  items: IRelationRef[]
  /** Provide to enable remove buttons (edit mode). Omit for read-only (view mode). */
  onRemove?: (slug: string) => void
  emptyText?: string
}

export function RelationBadgeGroup({ items, onRemove, emptyText = 'None' }: RelationBadgeGroupProps) {
  if (!items || items.length === 0) {
    return <span className="text-xs text-muted-foreground">{emptyText}</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item.slug}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
        >
          {item.displayName}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(item.slug)}
              className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground focus:outline-none"
              aria-label={`Remove ${item.displayName}`}
            >
              <IconX size={10} />
            </button>
          )}
        </span>
      ))}
    </div>
  )
}
