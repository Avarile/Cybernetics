"use client"

import { useCallback, useEffect, useState } from "react"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/errors"
import { useApi } from "@/lib/api/provider"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { RECORD_FORMS } from "./record-forms"
import { omitBlank, type FormFieldSpec } from "./record-form"

export type RecordMode = "create" | "edit" | "detail"

export interface RecordWindowProps {
  domain: string
  endpoint: string
  mode: RecordMode
  id?: string
  onDone?: () => void
  __windowId?: string
}

/** One component for create, edit and detail — they differ only in whether the
 *  fields are editable and where the initial values come from. */
export function RecordWindow({
  domain,
  endpoint,
  mode,
  id,
  onDone,
  __windowId,
}: RecordWindowProps) {
  const { client } = useApi()
  const closeWindow = useWorkspaceStore((s) => s.closeWindow)
  const spec = RECORD_FORMS[domain]

  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(mode !== "create")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => {
    if (__windowId) closeWindow(__windowId)
  }, [__windowId, closeWindow])

  useEffect(() => {
    if (mode === "create" || !id) return
    let cancelled = false
    void (async () => {
      try {
        const row = await client.get<Record<string, unknown>>(`${endpoint}/${id}`)
        if (cancelled) return
        const next: Record<string, string> = {}
        for (const f of spec?.fields ?? []) {
          const v = row[f.key]
          next[f.key] = v == null ? "" : String(v)
        }
        setValues(next)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "Could not load this record")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [client, endpoint, id, mode, spec])

  if (!spec) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No form is configured for “{domain}”.
      </p>
    )
  }

  const readOnly = mode === "detail"

  async function save() {
    const problem = spec.validate?.(values)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const body = (spec.serialize ?? omitBlank)(values)
      if (mode === "create") await client.post(endpoint, body)
      else await client.patch(`${endpoint}/${id}`, body)
      onDone?.()
      close()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  const fields = spec.fields.filter((f) => !(f.createOnly && mode !== "create"))

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
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
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
        <Button variant="outline" size="sm" onClick={close}>
          {readOnly ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </Button>
        )}
      </div>
    </div>
  )
}

function RecordField({
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
