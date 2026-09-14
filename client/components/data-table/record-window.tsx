"use client"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/errors"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { useRecord } from "@/features/records/use-record"
import { useRecordMutations } from "@/features/records/use-record-mutations"
import { scopes } from "@/lib/swr/keys"
import { useInvalidate } from "@/lib/swr/use-invalidate"
import { RECORD_FORMS } from "./record-forms"
import { RecordForm } from "./record-form"
import { RecordTabs } from "./record-relations"
import { omitBlank } from "./record-form-spec"

export type RecordMode = "create" | "edit" | "detail"

export interface RecordWindowProps {
  domain: string
  endpoint: string
  mode: RecordMode
  id?: string
  /**
   * Render from a row already in hand instead of fetching.
   *
   * For a domain with a list endpoint but no item endpoint — `/notifications`
   * is the case: `GET /notifications/:id` does not exist, so a row click
   * would 404 if this window insisted on fetching.
   */
  seed?: Record<string, unknown>
  __windowId?: string
}

/** One component for create, edit and detail — they differ only in whether the
 *  fields are editable and where the initial values come from. */
export function RecordWindow({
  domain,
  endpoint,
  mode,
  id,
  seed,
  __windowId,
}: RecordWindowProps) {
  // `__windowId` is only absent when this component is rendered outside a
  // WindowLayer (e.g. in tests); `useWindowControls` still needs some id to
  // call the hook with, and closing a window that doesn't exist is a no-op.
  const { close: closeWindow } = useWindowControls(__windowId ?? "")
  const spec = RECORD_FORMS[domain]
  // A seeded window holds its row already; keying the fetch null leaves the
  // hook idle rather than requesting an endpoint that does not exist.
  const fetched = useRecord(endpoint, mode === "create" || seed ? undefined : id)
  const response = seed ?? fetched.record
  // `unwrap` exists for responses that nest the record under a key. The
  // relations still need the whole response, because that is where their
  // rows live.
  const record = response && spec?.unwrap ? spec.unwrap(response) : response
  const isLoading = seed ? false : fetched.isLoading
  const loadError = seed ? undefined : fetched.error
  const { create, update } = useRecordMutations(endpoint)
  const invalidate = useInvalidate()

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
  const [conflict, setConflict] = useState(false)

  // A save error takes priority once the user has tried to act; otherwise
  // fall back to whatever kept the record from loading in the first place.
  const displayError =
    error ??
    (loadError
      ? loadError instanceof ApiError
        ? loadError.message
        : "Could not load this record"
      : null)

  const close = useCallback(() => {
    if (__windowId) closeWindow()
  }, [__windowId, closeWindow])

  // Adjusting state during render (not in an effect) on a prop/derived-data
  // change is the documented React pattern for this: it re-renders once, before
  // anything paints, rather than committing stale values and then correcting
  // them a frame later the way an effect-driven `setValues` would.
  if (mode === "detail" ? record !== seededFrom : record && !seeded) {
    setSeeded(true)
    setSeededFrom(record ?? null)
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
      // A 409 is not a generic failure: someone else saved this record since
      // it was loaded, and `expectedVersion` caught it. Saying "could not
      // save" would invite a retry that either fails again or — if the form
      // dropped the version — silently overwrites their work.
      if (err instanceof ApiError && err.statusCode === 409) {
        setConflict(true)
        setError("This was changed by someone else since you opened it.")
      } else {
        setError(err instanceof ApiError ? err.message : "Could not save")
      }
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

  const form = (
    <RecordForm
      spec={spec}
      values={values}
      creating={mode === "create"}
      readOnly={readOnly}
      saving={saving}
      error={displayError}
      onChange={(key, v) => setValues((prev) => ({ ...prev, [key]: v }))}
      onSave={() => void save()}
      onCancel={close}
    />
  )

  /** Discard the stale form and re-seed from whatever is current. */
  function reload() {
    setConflict(false)
    setError(null)
    setSeeded(false)
    setSeededFrom(null)
    void invalidate(scopes.allRecords(endpoint))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {conflict && (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-destructive/10 px-5 py-2"
        >
          <p className="text-xs text-destructive">
            Someone else changed this record. Reload to see the current version.
          </p>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={reload}>
            Reload
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {/* Relations need a saved parent to hang off, so they appear on an
            existing record and not while one is being created. */}
        {spec.relations?.length && id && mode !== "create" ? (
          <RecordTabs recordId={id} relations={spec.relations} record={response ?? {}}>
            {form}
          </RecordTabs>
        ) : (
          form
        )}
      </div>
    </div>
  )
}
