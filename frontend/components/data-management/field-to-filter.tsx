'use client'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { FieldSpec, FilterValue } from '@/lib/interfaces/search.interface'

export function FilterControl({
  field,
  value,
  onChange,
}: {
  field: FieldSpec
  value: FilterValue | undefined
  onChange: (v: FilterValue | undefined) => void
}) {
  if (field.enum && field.enum.length) {
    const selected = Array.isArray(value) ? value.map(String) : []
    const toggle = (opt: string, checked: boolean) => {
      const next = checked ? [...selected, opt] : selected.filter((v) => v !== opt)
      onChange(next.length ? next : undefined)
    }
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{field.name}</span>
        {field.enum.map((opt) => {
          const key = String(opt)
          return (
            <div key={key} className="flex items-center gap-2">
              <Checkbox
                id={`f-${field.name}-${key}`}
                checked={selected.includes(key)}
                onCheckedChange={(c) => toggle(key, !!c)}
              />
              <Label htmlFor={`f-${field.name}-${key}`}>{key}</Label>
            </div>
          )
        })}
      </div>
    )
  }

  if (field.type === 'boolean') {
    const v = value === undefined ? 'any' : value ? 'true' : 'false'
    return (
      <div className="flex flex-col gap-2">
        <Label htmlFor={`f-${field.name}`}>{field.name}</Label>
        <Select
          value={v}
          onValueChange={(next) => onChange(next === 'any' ? undefined : next === 'true')}
        >
          <SelectTrigger id={`f-${field.name}`} className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any</SelectItem>
            <SelectItem value="true">Yes</SelectItem>
            <SelectItem value="false">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    )
  }

  const isNumber = field.type === 'number'
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`f-${field.name}`}>{field.name}</Label>
      <Input
        id={`f-${field.name}`}
        type={isNumber ? 'number' : 'text'}
        value={value === undefined ? '' : String(value)}
        placeholder="Exact match"
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') return onChange(undefined)
          onChange(isNumber ? Number(raw) : raw)
        }}
      />
    </div>
  )
}
