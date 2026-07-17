'use client'

import * as React from 'react'
import { Controller, type Control } from 'react-hook-form'
import { HugeiconsIcon } from '@hugeicons/react'
import { CloudUploadIcon, File01Icon, Cancel01Icon, Download01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useFileUpload } from '@/lib/hooks/use-file-upload'
import { fileService } from '@/lib/services/file.service'

export function AttachmentsField({
  control,
  name,
  collection,
  externalId,
}: {
  control: Control<Record<string, unknown>>
  name: string
  collection: string
  externalId: string
}) {
  const { items, uploadAll } = useFileUpload()

  return (
    <Controller
      control={control}
      name={name}
      render={({ field: f }) => {
        const ids: string[] = Array.isArray(f.value) ? (f.value as string[]) : []

        const onFiles = async (files: FileList | null) => {
          if (!files || files.length === 0) return
          const newIds = await uploadAll(Array.from(files), { collection, externalId })
          f.onChange([...ids, ...newIds])
        }

        return (
          <Field>
            <FieldLabel htmlFor={`att-${name}`}>{name}</FieldLabel>
            <label
              htmlFor={`att-${name}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files) }}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground hover:bg-muted/40"
            >
              <HugeiconsIcon icon={CloudUploadIcon} strokeWidth={2} className="size-6" />
              Drop files here or click to upload
              <input
                id={`att-${name}`}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
            </label>

            {items.some((it) => it.status === 'uploading') && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner /> Uploading…
              </div>
            )}

            {ids.length > 0 && (
              <ul className="flex flex-col gap-1">
                {ids.map((id) => (
                  <AttachmentRow
                    key={id}
                    id={id}
                    onRemove={() => f.onChange(ids.filter((x) => x !== id))}
                  />
                ))}
              </ul>
            )}
          </Field>
        )
      }}
    />
  )
}

function AttachmentRow({ id, onRemove }: { id: string; onRemove: () => void }) {
  const [filename, setFilename] = React.useState<string>(id)
  React.useEffect(() => {
    let alive = true
    fileService.get(id).then((m) => { if (alive) setFilename(m.filename) }).catch(() => {})
    return () => { alive = false }
  }, [id])

  const download = async () => {
    const url = await fileService.downloadUrl(id)
    window.open(url, '_blank', 'noopener')
  }

  return (
    <li className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
      <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-4 text-muted-foreground" />
      <span className="flex-1 truncate">{filename}</span>
      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={download}>
        <HugeiconsIcon icon={Download01Icon} strokeWidth={2} className="size-4" />
        <span className="sr-only">Download</span>
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onRemove}>
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-4" />
        <span className="sr-only">Remove</span>
      </Button>
    </li>
  )
}
