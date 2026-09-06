"use client"

import { useCallback, useState } from "react"
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
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useRecord } from "@/features/records/use-record"
import { useRecordMutations } from "@/features/records/use-record-mutations"
import { RECORD_FORMS } from "./record-forms"
import { omitBlank, type FormFieldSpec } from "./record-form"

export type RecordMode = "create" | "edit" | "detail"

export interface RecordWindowProps {
  domain: string
  endpoint: string
  mode: RecordMode
  id?: string
  __windowId?: string
}

/** One component for create, edit and detail — they differ only in whether the
 *  fields are editable and where the initial values come from. */
export function RecordWindow({
  domain,
  endpoint,
  mode,
  id,
  __windowId,
}: RecordWindowProps) {
  // `__windowId` is only absent when this component is rendered outside a
  // WindowLayer (e.g. in tests); `useWindowControls` still needs some id to
  // call the hook with, and closing a window that doesn't exist is a no-op.
  const { close: closeWindow } = useWindowControls(__windowId ?? "")
  const spec = RECORD_FORMS[domain]
  const { record, isLoading, error: loadError } = useRecord(endpoint, mode === "create" ? undefined : id)
  const { create, update } = useRecordMutations(endpoint)

  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Seed the form from the loaded record exactly ONCE. Deliberately not keyed
  // on `record`'s identity: this hook is cache-connected now, so any
  // invalidation of `["record", endpoint]` — including one caused by an
  // unrelated row's update or delete in another window — hands back a fresh
  // object. Re-seeding on that would silently overwrite whatever the user has
  // typed. A stale form is recoverable; discarded input is not. This window is
  // per-record (its singletonKey embeds the id), so `id` never changes for a
  // given instance — there is no case where re-seeding is wanted.
  //
  // `detail` is the one exception: it's read-only (see `readOnly` below), so
  // there is nothing typed to protect, and everything to gain from staying in
  // sync — a sibling edit window saving this same record invalidates
  // `["record", endpoint]`, and detail should reflect that rather than
  // freezing on the snapshot from first paint. It gets its own identity-keyed
  // tracker (`seededFrom`) instead of reusing the one-shot `seeded` guard:
  // re-seeding on every render where `record` is merely present (rather than
  // *changed*) would call `setValues` with a fresh object every pass and loop
  // forever, since each `next` is a new reference even when its content is
  // identical to what's already in `values`. Gating on identity is safe here
  // specifically because SWR only ever hands back a new `record` reference
  // when the fetched content actually changed (see the `dequal`-based
  // `compare` note in the round-1 test) — so this can't loop the way an
  // unconditional re-seed would.
  const [seeded, setSeeded] = useState(false)
  const [seededFrom, setSeededFrom] = useState<Record<string, unknown> | null>(null)

  // A save error takes priority once the user has tried to act; otherwise
  // fall back to whatever kept the record from loading in the first place.
  const displayError =
    error ?? (loadError ? (loadError instanceof ApiError ? loadError.message : "Could not load this record") : null)

  const close = useCallback(() => {
    if (__windowId) closeWindow()
  }, [__windowId, closeWindow])

  // Adjusting state during render (not in an effect) on a prop/derived-data
  // change is the documented React pattern for this: it re-renders once, before
  // anything paints, rather than committing stale values and then correcting
  // them a frame later the way an effect-driven `setValues` would.
  if (mode === "detail" ? record !== seededFrom : record && !seeded) {
    setSeeded(true)
    setSeededFrom(record)
    if (record) {
      const next: Record<string, string> = {}
      for (const f of spec?.fields ?? []) {
        const v = record[f.key]
        next[f.key] = v == null ? "" : String(v)
      }
      setValues(next)
    }
  }

  if (!spec) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No form is configured for “{domain}”.
      </p>
    )
  }

  const readOnly = mode === "detail"
  const loading = mode !== "create" && isLoading

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
      if (mode === "create") await create(body)
      else await update(id!, body)
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

        {displayError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {displayError}
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
