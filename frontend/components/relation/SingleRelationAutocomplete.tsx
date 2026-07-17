'use client'

import { useEffect, useRef, useState } from 'react'
import { IconX } from '@tabler/icons-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { IRelationRef } from '@/lib/interfaces/shared.interface'

interface SingleRelationAutocompleteProps {
  label: string
  selected: IRelationRef | null
  onSelect: (item: IRelationRef | null) => void
  search: (q: string) => Promise<IRelationRef[]>
  placeholder?: string
  disabled?: boolean
  /**
   * If true, focusing/clicking the input with an empty query will still call `search("")`
   * and show the dropdown (useful for "recent items" lists).
   */
  searchOnEmpty?: boolean
}

/**
 * Single-select autocomplete backed by a debounced API search.
 * Displays the selected item as a removable chip below the input.
 * Searching while an item is already selected replaces it on pick.
 */
export function SingleRelationAutocomplete({
  label,
  selected,
  onSelect,
  search,
  placeholder = 'Search…',
  disabled = false,
  searchOnEmpty = false,
}: SingleRelationAutocompleteProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IRelationRef[]>([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ── Debounced search ────────────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    // Don't auto-fetch "recent items" unless the dropdown is open (e.g. focused/clicked).
    if (!trimmed && (!searchOnEmpty || !open)) { setResults([]); return }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      setOpen(true)
      try {
        const res = await search(trimmed)
        setResults(res)
        setOpen(true)
        setActiveIdx(-1)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, search, searchOnEmpty, open])

  // ── Close on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleSelect(item: IRelationRef) {
    onSelect(item)
    setQuery('')
    setResults([])
    setOpen(false)
    setActiveIdx(-1)
    setLoading(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      handleSelect(results[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (disabled) return
          if (results.length > 0) setOpen(true)
          if (searchOnEmpty && !query.trim()) setOpen(true)
        }}
        placeholder={loading ? 'Searching…' : placeholder}
        disabled={disabled}
        className="h-8 text-sm"
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border bg-popover text-sm shadow-md">
          {loading && (
            <li className="px-3 py-2 text-muted-foreground">Searching…</li>
          )}
          {!loading && results.length === 0 && (
            <li className="px-3 py-2 text-muted-foreground">No results</li>
          )}
          {!loading && results.map((item, idx) => (
              <li
                key={item.slug}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(item) }}
                className={[
                  'cursor-pointer px-3 py-1.5 hover:bg-accent',
                  idx === activeIdx ? 'bg-accent' : '',
                ].join(' ')}
              >
                {item.displayName}
              </li>
            ))}
        </ul>
      )}

      {/* Selected chip */}
      {selected && (
        <div className="flex items-center gap-1 pt-0.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
            {selected.displayName}
            {!disabled && (
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground focus:outline-none"
                aria-label={`Remove ${selected.displayName}`}
              >
                <IconX size={10} />
              </button>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
