'use client'

import * as React from 'react'
import { Controller, type Control, type ControllerRenderProps } from 'react-hook-form'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

type F = ControllerRenderProps<Record<string, unknown>, string>

export function RecordFieldInput({
  field,
  control,
}: {
  field: FieldSpec
  control: Control<Record<string, unknown>>
}) {
  return (
    <Controller
      control={control}
      name={field.name}
      render={({ field: f, fieldState }) => (
        <Field data-invalid={fieldState.error ? 'true' : undefined}>
          <FieldLabel htmlFor={field.name}>
            {field.name}
            {field.required ? ' *' : ''}
          </FieldLabel>
          {renderWidget(field, f)}
          {fieldState.error && <FieldError>{fieldState.error.message}</FieldError>}
        </Field>
      )}
    />
  )
}

function renderWidget(field: FieldSpec, f: F) {
  if (field.enum && field.type !== 'string[]' && field.type !== 'number[]') {
    return (
      <Select value={f.value ? String(f.value) : ''} onValueChange={f.onChange}>
        <SelectTrigger id={field.name} className="w-full">
          <SelectValue placeholder={`Select ${field.name}`} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {field.enum.map((opt) => (
              <SelectItem key={String(opt)} value={String(opt)}>{String(opt)}</SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    )
  }
  switch (field.type) {
    case 'boolean':
      return <Switch id={field.name} checked={!!f.value} onCheckedChange={f.onChange} />
    case 'number':
      return (
        <Input
          id={field.name}
          type="number"
          value={f.value === undefined || f.value === null ? '' : String(f.value)}
          onChange={(e) => f.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    case 'date':
      return (
        <Input
          id={field.name}
          type="date"
          value={typeof f.value === 'string' ? f.value : ''}
          onChange={(e) => f.onChange(e.target.value)}
        />
      )
    case 'string[]':
    case 'number[]':
      return <TagsInput id={field.name} value={f.value} numeric={field.type === 'number[]'} onChange={f.onChange} />
    default:
      return (
        <Input
          id={field.name}
          value={typeof f.value === 'string' ? f.value : ''}
          onChange={(e) => f.onChange(e.target.value)}
        />
      )
  }
}

function TagsInput({
  id,
  value,
  numeric,
  onChange,
}: {
  id: string
  value: unknown
  numeric?: boolean
  onChange: (v: unknown[]) => void
}) {
  const items = Array.isArray(value) ? value : []
  const [draft, setDraft] = React.useState('')

  const add = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onChange([...items, numeric ? Number(trimmed) : trimmed])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add() }
          }}
          placeholder="Type and press Enter"
        />
        <Button type="button" variant="outline" onClick={add}>Add</Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {items.map((it, i) => (
            <Badge key={i} variant="secondary" className="gap-1">
              {String(it)}
              <button
                type="button"
                aria-label={`Remove ${String(it)}`}
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
