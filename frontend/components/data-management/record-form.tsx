'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { RecordFieldInput } from '@/components/data-management/field-to-input'
import { AttachmentsField } from '@/components/data-management/attachments-field'
import { buildRecordSchema } from '@/lib/schema/field-to-zod'
import { useRecordMutations } from '@/lib/hooks/use-record-mutations'
import { ApiError } from '@/lib/http/api-client'
import type { FieldSpec, RecordDocument } from '@/lib/interfaces/search.interface'
import type { ZodType } from 'zod'

const ATTACHMENTS_FIELD = 'attachments'

/** Per-type empty default so an untouched required field is e.g. '' (triggers the
 * schema's custom "X is required" message) rather than undefined (which fails zod's
 * base type check first with a generic, non-custom message). Numbers are the
 * exception: a blank number input must submit as undefined, not '' (which
 * z.coerce.number() would otherwise coerce to 0, silently bypassing `required`). */
function emptyValueFor(f: FieldSpec): unknown {
  switch (f.type) {
    case 'boolean': return false
    case 'string[]':
    case 'number[]': return []
    case 'number': return undefined
    default: return ''
  }
}

function defaultValuesFor(fields: FieldSpec[], doc: RecordDocument = {}): RecordDocument {
  const out: RecordDocument = {}
  for (const f of fields) out[f.name] = f.name in doc ? doc[f.name] : emptyValueFor(f)
  return out
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `rec_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
}

export function RecordForm({
  fields,
  collection,
  mode,
  initialDocument,
  externalId: externalIdProp,
  onDone,
}: {
  fields: FieldSpec[]
  collection: string
  mode: 'create' | 'edit'
  initialDocument?: RecordDocument
  externalId?: string
  onDone: () => void
}) {
  const { create } = useRecordMutations()
  const [externalId] = React.useState<string>(() => externalIdProp ?? genId())
  // buildRecordSchema's declared return type leaves the zod "Input" generic at its
  // `unknown` default, which zodResolver's overloads reject (they require Input to
  // extend RHF's FieldValues). The schema is a plain z.object() of concrete fields,
  // so this cast only widens the type-level Input param to match — no runtime effect.
  const schema = React.useMemo(
    () => buildRecordSchema(fields) as unknown as ZodType<Record<string, unknown>, Record<string, unknown>>,
    [fields],
  )

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(schema),
    defaultValues: defaultValuesFor(fields, initialDocument),
  })

  const attachmentsField = fields.find((f) => f.name === ATTACHMENTS_FIELD && f.type === 'string[]')

  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      await create({ externalId, document: values })
      onDone()
    } catch (err) {
      if (err instanceof ApiError) {
        const fieldErrors = err.fieldErrors
        let mapped = false
        for (const [path, message] of Object.entries(fieldErrors)) {
          if (path !== '_root') { form.setError(path, { message }); mapped = true }
        }
        if (!mapped) toast.error(err.message)
      } else {
        toast.error('Failed to save record')
      }
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      <FieldGroup>
        {fields.map((field) =>
          field === attachmentsField ? (
            <AttachmentsField
              key={field.name}
              control={form.control}
              name={field.name}
              collection={collection}
              externalId={externalId}
            />
          ) : (
            <RecordFieldInput key={field.name} field={field} control={form.control} />
          ),
        )}
      </FieldGroup>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Saving…' : mode === 'create' ? 'Create record' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
