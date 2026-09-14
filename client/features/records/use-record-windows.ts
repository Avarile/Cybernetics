"use client"

import { useMemo } from "react"
import { useWorkspace } from "@/features/workspace/use-workspace"
import type { JsonObject } from "@/lib/state/json"
import { RECORD_FORMS } from "@/components/data-table/record-forms"
import type { DomainTableConfig, HasId } from "@/components/data-table/types"

/** Singular form for a window title: "Contacts" → "contact". */
function singular(title: string): string {
  return title.replace(/ies$/, "y").replace(/s$/, "").toLowerCase()
}

/**
 * The four DataTable handlers, derived from a config rather than typed out.
 *
 * `contacts-window.tsx` hand-wrote these four `openWindow` calls. Twenty-eight
 * sections times four is the duplication this window exists to avoid — and
 * every hand-written copy is a chance for one domain's `singletonKey` to drift
 * from the convention, which turns "focus the open window" into "stack a
 * second one".
 *
 * `props.domain` carries `config.key`, which is also what `RECORD_FORMS` is
 * keyed on. The two key spaces must stay identical, so `config.key` is the
 * single source for both.
 */
export function useRecordWindows<T extends HasId>(
  config: DomainTableConfig<T>,
  titleOf: (row: T) => string,
) {
  const { openWindow } = useWorkspace()
  const { key, endpoint, title } = config

  return useMemo(() => {
    // Every record window renders `RECORD_FORMS[domain]`. Without one it
    // renders "No form is configured for …" — a dead end reached by an
    // ordinary row click. Files is the case: it has no create, no edit and
    // no form, so it must not be given an opener either.
    const hasForm = Boolean(RECORD_FORMS[key])
    // Eleven endpoints have a list route and no `GET /:id` — verified live.
    // A record window opened against one 404s on load, so it is handed the
    // row it was opened from instead.
    // The cast is sound and the alternative is worse. A row came out of
    // `JSON.parse`, so it IS a JsonObject; `T extends HasId` simply cannot
    // prove that to the compiler. Record windows are in NEVER_PERSIST, so
    // this never reaches localStorage either way.
    const seeded = (row: T): JsonObject =>
      config.noItemEndpoint ? { seed: row as unknown as JsonObject } : {}

    return {
      onOpen: hasForm
        ? (row: T) =>
            openWindow({
              kind: "record-detail",
              title: titleOf(row),
              singletonKey: `${key}:detail:${row.id}`,
              props: { domain: key, endpoint, id: row.id, ...seeded(row) },
            })
        : undefined,

      onCreate: hasForm
        ? () =>
            openWindow({
              kind: "record-create",
              title: `New ${singular(title)}`,
              singletonKey: `${key}:create`,
              props: { domain: key, endpoint },
            })
        : undefined,

      onEdit: hasForm
        ? (row: T) =>
            openWindow({
              kind: "record-edit",
              title: `Edit ${titleOf(row)}`,
              singletonKey: `${key}:edit:${row.id}`,
              props: { domain: key, endpoint, id: row.id, ...seeded(row) },
            })
        : undefined,

      onDelete: (rows: T[]) => {
        // The path segment DELETE uses, which is the row id unless the domain
        // says otherwise: suppressions delete by email, members by userId,
        // preferences by key.
        const keys = rows.map(config.deleteKey ?? ((r: T) => r.id))
        const noun = singular(title)
        openWindow({
          kind: "confirm",
          title: `Delete ${noun}${rows.length === 1 ? "" : "s"}`,
          // Keyed on the selection, so one dialog per selection rather than
          // one per click.
          singletonKey: `confirm:${key}:${keys.join(",")}`,
          props: {
            message: `Delete ${rows.length} ${noun}${rows.length === 1 ? "" : "s"}?`,
            confirmLabel: "Delete",
            destructive: true,
            ids: keys,
            endpoint,
          },
        })
      },
    }
    // `config.deleteKey` is a function identity. It is stable now that
    // SectionHost memoises the config it builds; before that it changed every
    // render for a scoped table and rebuilt all four openers each time, which
    // re-rendered DataTable with new props on every pass.
  }, [openWindow, key, endpoint, title, titleOf, config.deleteKey, config.noItemEndpoint])
}
