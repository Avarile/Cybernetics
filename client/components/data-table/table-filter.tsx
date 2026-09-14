"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useLookup } from "@/features/records/use-lookup"
import type { FilterSpec } from "./types"

const ANY = "__all"

/**
 * One toolbar filter.
 *
 * Split out of `data-table.tsx` because a filter whose options come from an
 * endpoint needs a hook, and a hook cannot be called inside the `.map()` that
 * renders the filter row.
 */
export function TableFilter({
  spec,
  value,
  onChange,
}: {
  spec: FilterSpec
  value: string
  onChange: (value: string) => void
}) {
  if (spec.source) return <SourcedFilter spec={spec} value={value} onChange={onChange} />
  return <StaticFilter spec={spec} options={spec.options ?? []} value={value} onChange={onChange} />
}

function SourcedFilter({
  spec,
  value,
  onChange,
}: {
  spec: FilterSpec
  value: string
  onChange: (value: string) => void
}) {
  const source = spec.source!
  const { options, isLoading, truncated } = useLookup(
    source.endpoint,
    source.labelKey,
    source.valueKey,
  )

  const control = (
    <StaticFilter
      spec={spec}
      options={options}
      value={value}
      onChange={onChange}
      disabled={isLoading || options.length === 0}
      placeholder={isLoading ? "Loading…" : undefined}
    />
  )

  // A truncated option list looks identical to a complete one, and a user who
  // cannot find their project in it concludes the filter is broken rather
  // than full.
  if (!truncated) return control
  return (
    <Tooltip>
      <TooltipTrigger asChild>{control}</TooltipTrigger>
      <TooltipContent>Showing the first {options.length} — there may be more</TooltipContent>
    </Tooltip>
  )
}

function StaticFilter({
  spec,
  options,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  spec: FilterSpec
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  return (
    <Select value={value || ANY} onValueChange={(v) => onChange(v === ANY ? "" : v)} disabled={disabled}>
      <SelectTrigger size="sm" className="h-8 w-auto min-w-28 text-xs" aria-label={spec.label}>
        <SelectValue placeholder={placeholder ?? spec.label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{spec.label}: any</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
