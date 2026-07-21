'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { canBeSearchable, canBeSortable } from '@/lib/schema/validate-field-spec'
import type { FieldSpec, FieldType } from '@/lib/interfaces/search.interface'

const TYPES: FieldType[] = ['string', 'number', 'boolean', 'date', 'string[]', 'number[]']
const FLAGS = ['required', 'searchable', 'filterable', 'sortable'] as const

export function FieldSpecEditor({
  value, onChange,
}: {
  value: FieldSpec[]
  onChange: (next: FieldSpec[]) => void
}) {
  const patch = (i: number, next: Partial<FieldSpec>) =>
    onChange(value.map((f, idx) => (idx === i ? sanitize({ ...f, ...next }) : f)))
  const add = () => onChange([...value, { name: '', type: 'string' }])
  const removeRow = (i: number) => onChange(value.filter((_, idx) => idx !== i))

  return (
    <div className="flex flex-col gap-3">
      {value.map((f, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Input aria-label={`field-name-${i}`} placeholder="field_name" value={f.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <Select value={f.type} onValueChange={(t) => patch(i, { type: t as FieldType })}>
              <SelectTrigger className="w-36" aria-label={`field-type-${i}`}><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} aria-label={`remove-field-${i}`}>
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-4">
            {FLAGS.map((flag) => {
              const disabled =
                (flag === 'searchable' && !canBeSearchable(f.type)) ||
                (flag === 'sortable' && !canBeSortable(f.type))
              return (
                <div key={flag} className="flex items-center gap-2">
                  <Checkbox id={`f-${i}-${flag}`} checked={!!f[flag]} disabled={disabled} onCheckedChange={(c) => patch(i, { [flag]: !!c })} />
                  <Label htmlFor={`f-${i}-${flag}`} className="capitalize">{flag}</Label>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={add} className="self-start">
        <HugeiconsIcon icon={Add01Icon} strokeWidth={2} /> Add field
      </Button>
    </div>
  )
}

/** Clear flags a type can no longer support after a type change. */
function sanitize(f: FieldSpec): FieldSpec {
  const out = { ...f }
  if (out.searchable && !canBeSearchable(out.type)) out.searchable = false
  if (out.sortable && !canBeSortable(out.type)) out.sortable = false
  return out
}
