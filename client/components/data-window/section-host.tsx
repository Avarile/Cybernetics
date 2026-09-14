"use client"

import { useMemo, useState, type ReactNode } from "react"
import { DataTable } from "@/components/data-table/data-table"
import { RecordForm } from "@/components/data-table/record-form"
import { omitBlank } from "@/components/data-table/record-form-spec"
import { RECORD_FORMS } from "@/components/data-table/record-forms"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/lib/api/errors"
import { useRecordWindows } from "@/features/records/use-record-windows"
import { useSingletonRecord } from "@/features/records/use-singleton-record"
import type { SectionBody, SectionSpec, TableExtras } from "./types"

/**
 * Renders one section.
 *
 * Each `SectionBody` variant gets its own component rather than a `switch` arm,
 * because the arms call hooks (`useRecordWindows`, and later `useLookup` and
 * `useSingletonRecord`). A hook inside a branch that may not run is a rules-of-
 * hooks violation, and the failure is a render-order crash rather than a lint
 * error, so the split is structural — not a style choice to be tidied away.
 *
 * The caller supplies the mount key (domain:section:scope), so switching
 * section unmounts this subtree: page, search, filters, view tab, selection
 * and hidden columns all reset. That is intended — a section is a different
 * resource, and page 7 of Transactions means nothing in Invoices.
 */
export function SectionHost({
  section,
  scopeId,
}: {
  section: SectionSpec
  /** The chosen parent for a scoped section; undefined until one is picked. */
  scopeId?: string
}) {
  const body = section.body as SectionBody<HasId>

  switch (body.kind) {
    case "table":
      return (
        <TableSection
          config={body.config}
          titleOf={body.titleOf}
          useExtras={body.useExtras}
          wrapper={body.wrapper}
        />
      )

    case "scoped-table":
      // No parent, no request. An error would be wrong (nothing failed) and
      // an empty table would be a lie (nothing was asked for).
      if (!scopeId) {
        return (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyTitle>{section.label}</EmptyTitle>
              <EmptyDescription>{body.scope.placeholder}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
      }
      return (
        <ScopedTableSection
          build={body.config}
          scopeId={scopeId}
          titleOf={body.titleOf}
          useExtras={body.useExtras}
          wrapper={body.wrapper}
        />
      )

    case "form":
      return <FormSection endpoint={body.endpoint} spec={body.spec} />

    case "custom":
      return <>{body.render()}</>
  }
}

/**
 * A scoped section's config, built once per parent id rather than per render.
 *
 * `config` is a FACTORY here, because the endpoint embeds the parent id. Calling
 * it in the render body — which is what this component exists to stop — handed
 * every render a brand-new config object, a new `columns` array and a new
 * closure for every `cell`, `canEdit` and `deleteKey`. Nothing downstream could
 * then memoise: `useCollection` re-ran its whole filter/search/sort/slice,
 * `DataTable` rebuilt its column list, and `useRecordWindows` rebuilt the four
 * openers, on every single render of the window.
 *
 * A separate component rather than a `useMemo` inside `SectionHost`, because
 * `SectionHost` returns before this point for three of its four body kinds and
 * a hook cannot live behind that switch.
 */
function ScopedTableSection<T extends HasId>({
  build,
  scopeId,
  ...rest
}: {
  build: (parentId: string) => DomainTableConfig<T>
  scopeId: string
  titleOf: (row: T) => string
  useExtras?: TableExtras<T>
  wrapper?: React.ComponentType<{ children: ReactNode }>
}) {
  const config = useMemo(() => build(scopeId), [build, scopeId])
  return <TableSection config={config} {...rest} />
}

function TableSection<T extends HasId>({
  config,
  titleOf,
  useExtras,
  wrapper: Wrapper,
}: {
  config: DomainTableConfig<T>
  titleOf: (row: T) => string
  useExtras?: TableExtras<T>
  wrapper?: React.ComponentType<{ children: ReactNode }>
}) {
  // Called unconditionally: `useExtras` is fixed per section, and a section
  // switch remounts this component rather than swapping the hook underneath it.
  const extras = useExtras?.()
  // Memoised, not spread inline. The merge result is the `config` every hook
  // below keys its memo on, and a fresh object each render defeated all of
  // them — see ScopedTableSection. Every `useExtras` in the codebase already
  // returns a `useMemo`d object, so this is stable in practice.
  const merged = useMemo(() => ({ ...config, ...extras }), [config, extras])
  const nav = useRecordWindows(merged, titleOf)

  const table = <DataTable config={merged} {...nav} />
  return Wrapper ? <Wrapper>{table}</Wrapper> : table
}

/**
 * A resource of one, rendered as a pane rather than a window.
 *
 * `/me/profile` has no id and no list — it is a form the user edits in place.
 * Seeding is identity-keyed rather than one-shot: unlike a record window
 * there is no second window that could be editing the same thing, and the
 * pane should reflect a save made elsewhere rather than freeze on first paint.
 */
function FormSection({ endpoint, spec: specKey }: { endpoint: string; spec: string }) {
  const spec = RECORD_FORMS[specKey]
  const { record, isLoading, error: loadError, save, saving } = useSingletonRecord<
    Record<string, unknown>
  >(endpoint)

  const [values, setValues] = useState<Record<string, string>>({})
  const [seededFrom, setSeededFrom] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Adjusting state during render on a derived-data change, as RecordWindow
  // does: one extra render before paint, rather than a committed empty form
  // corrected a frame later.
  if (record && record !== seededFrom) {
    setSeededFrom(record)
    const next: Record<string, string> = {}
    for (const f of spec?.fields ?? []) {
      const v = record[f.key]
      next[f.key] = v == null ? "" : String(v)
    }
    setValues(next)
  }

  if (!spec) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        No form is configured for “{specKey}”.
      </p>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-5">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }

  async function onSave() {
    const problem = spec.validate?.(values)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    try {
      await save((spec.serialize ?? omitBlank)(values))
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save")
    }
  }

  const displayError =
    error ?? (loadError ? "Could not load this profile" : null)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <RecordForm
        spec={spec}
        values={values}
        saving={saving}
        error={displayError}
        saveLabel="Save"
        // Nothing to cancel back to — this pane is not a window. Reverting to
        // the loaded record is the only meaningful discard.
        cancelLabel="Revert"
        onChange={(key, v) => {
          setSaved(false)
          setValues((prev) => ({ ...prev, [key]: v }))
        }}
        onSave={() => void onSave()}
        onCancel={() => setSeededFrom(null)}
      />
      {saved && !displayError && (
        <p role="status" className="shrink-0 px-5 pb-3 text-xs text-muted-foreground">
          Saved.
        </p>
      )}
    </div>
  )
}
