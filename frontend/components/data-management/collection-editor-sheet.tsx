'use client'

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FieldSpecEditor } from '@/components/data-management/field-spec-editor'
import { useCollectionMutations } from '@/lib/hooks/use-collection-mutations'
import { useCollectionDefinition } from '@/lib/hooks/use-collection-definition'
import { validateFieldSpec } from '@/lib/schema/validate-field-spec'
import { collectionFormSchema, type CollectionFormValues } from '@/lib/schema/field-spec-to-zod'
import { ApiError } from '@/lib/http/api-client'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function CollectionEditorSheet({
  open, mode, name, onClose,
}: {
  open: boolean
  mode: 'create' | 'edit'
  name?: string
  onClose: () => void
}) {
  const { create, update } = useCollectionMutations()
  const { definition, fields: existing } = useCollectionDefinition(mode === 'edit' ? (name ?? null) : null)
  const form = useForm<CollectionFormValues>({
    resolver: zodResolver(collectionFormSchema),
    defaultValues: { name: '', displayName: '', description: '' },
  })
  const [fields, setFields] = React.useState<FieldSpec[]>([])
  const [specErrors, setSpecErrors] = React.useState<string[]>([])
  const prefilledFor = React.useRef<string | null>(null)

  // Prefill at most once per open, per collection: SWR revalidating `definition`
  // while the sheet is open in edit mode must not refire form.reset and wipe
  // unsaved edits.
  React.useEffect(() => {
    if (!open) { prefilledFor.current = null; return }
    if (mode === 'create') {
      form.reset({ name: '', displayName: '', description: '' })
      setFields([])
      prefilledFor.current = '__create__'
      return
    }
    if (mode === 'edit' && definition && prefilledFor.current !== definition.name) {
      form.reset({ name: definition.name, displayName: definition.displayName, description: definition.description ?? '' })
      setFields(existing)
      prefilledFor.current = definition.name
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, definition])

  const onSubmit = async (values: CollectionFormValues) => {
    const errs = validateFieldSpec(fields)
    setSpecErrors(errs)
    if (errs.length) return
    try {
      if (mode === 'create') await create({ ...values, fields })
      else await update(name as string, { displayName: values.displayName, description: values.description ?? null, fields })
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save collection')
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{mode === 'create' ? 'New collection' : `Edit "${name}"`}</SheetTitle>
          <SheetDescription>Define the collection identity and its field schema.</SheetDescription>
        </SheetHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4 px-4 pb-6">
          <Field data-invalid={form.formState.errors.name ? 'true' : undefined}>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" disabled={mode === 'edit'} {...form.register('name')} />
            {form.formState.errors.name && <FieldError>{form.formState.errors.name.message}</FieldError>}
          </Field>
          <Field data-invalid={form.formState.errors.displayName ? 'true' : undefined}>
            <FieldLabel htmlFor="displayName">Display name</FieldLabel>
            <Input id="displayName" {...form.register('displayName')} />
            {form.formState.errors.displayName && <FieldError>{form.formState.errors.displayName.message}</FieldError>}
          </Field>
          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Input id="description" {...form.register('description')} />
          </Field>

          {mode === 'edit' && (
            <Alert>
              <AlertDescription>
                Changing fields triggers a background reindex and does not re-validate existing records.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Fields</span>
            <FieldSpecEditor value={fields} onChange={(f) => { setFields(f); setSpecErrors([]) }} />
            {specErrors.length > 0 && (
              <ul className="text-sm text-destructive">{specErrors.map((e) => <li key={e}>{e}</li>)}</ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {mode === 'create' ? 'Create collection' : 'Save changes'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
