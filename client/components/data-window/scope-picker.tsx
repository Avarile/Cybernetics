"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useLookup } from "@/features/records/use-lookup"
import type { SectionScope } from "./types"

/**
 * The parent selector for a scoped section.
 *
 * `GET /projects/:id/milestones` has no unscoped form — the id is in the path,
 * not a filter. Until one is chosen there is nothing to request, so this is a
 * precondition for the section rather than a filter over it, and it sits in
 * the pane header rather than in the table toolbar.
 */
export function ScopePicker({
  scope,
  value,
  onChange,
}: {
  scope: SectionScope
  value: string | undefined
  onChange: (id: string) => void
}) {
  const { options, isLoading } = useLookup(scope.from, scope.labelKey)

  return (
    <Select value={value ?? ""} onValueChange={onChange} disabled={isLoading}>
      <SelectTrigger size="sm" className="h-8 w-56 text-xs" aria-label={scope.placeholder}>
        <SelectValue placeholder={isLoading ? "Loading…" : scope.placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
