"use client"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { FormFieldSpec, RecordFormSpec } from "./record-form-spec"

export interface RecordFormProps {
  spec: RecordFormSpec
  values: Record<string, string>
  onChange: (key: string, value: string) => void
  onSave: () => void
  onCancel: () => void
  readOnly?: boolean
  saving?: boolean
  error?: string | null
  /** Hides create-only fields when false. */
  creating?: boolean
  saveLabel?: string
  cancelLabel?: string
}

/**
 * The fields, the error line and the footer — controlled and presentational.
 *
 * Split out of `RecordWindow` so `/me/profile` can render the same form
 * without a window around it. Everything stateful (loading the record,
 * seeding the values exactly once, saving) stays with the caller, because the
 * seeding rules differ between a window over a record and a pane over a
 * singleton.
 */
export function RecordForm({
  spec,
  values,
  onChange,
  onSave,
  onCancel,
  readOnly,
  saving,
  error,
  creating,
  saveLabel,
  cancelLabel,
}: RecordFormProps) {
  const fields = spec.fields.filter((f) => !(f.createOnly && !creating))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <FieldGroup>
          {fields.map((f) => (
            <RecordField
              key={f.key}
              spec={f}
              value={values[f.key] ?? ""}
              readOnly={readOnly || f.readOnly}
              onChange={(v) => onChange(f.key, v)}
            />
          ))}
        </FieldGroup>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-3">
        <Button variant="outline" size="sm" onClick={onCancel}>
          {cancelLabel ?? (readOnly ? "Close" : "Cancel")}
        </Button>
        {!readOnly && (
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : (saveLabel ?? (creating ? "Create" : "Save"))}
          </Button>
        )}
      </div>
    </div>
  )
}

export function RecordField({
  spec,
  value,
  readOnly,
  onChange,
}: {
  spec: FormFieldSpec
  value: string
  readOnly?: boolean
  onChange: (v: string) => void
}) {
  const id = `field-${spec.key}`

  return (
    <Field>
      <FieldLabel htmlFor={id}>{spec.label}</FieldLabel>

      {spec.kind === "textarea" ? (
        <Textarea
          id={id}
          value={value}
          readOnly={readOnly}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : spec.kind === "select" ? (
        <Select value={value} onValueChange={onChange} disabled={readOnly}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={spec.placeholder ?? "Choose…"} />
          </SelectTrigger>
          <SelectContent>
            {spec.options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={spec.kind === "date" ? "date" : spec.kind}
          value={value}
          readOnly={readOnly}
          maxLength={spec.maxLength}
          placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}

      {spec.help && <FieldDescription>{spec.help}</FieldDescription>}
    </Field>
  )
}
