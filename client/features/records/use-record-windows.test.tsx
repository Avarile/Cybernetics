import { renderHook, act } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useViewportStore } from "@/stores/viewport.store"
import type { DomainTableConfig } from "@/components/data-table/types"
import { useRecordWindows } from "./use-record-windows"

interface Row {
  id: string
  name: string
  email: string
}

const CONFIG: DomainTableConfig<Row> = {
  key: "contacts",
  title: "Contacts",
  endpoint: "/contacts",
  columns: [{ key: "name", header: "Name", cell: (r) => r.name }],
}

const ROW: Row = { id: "r1", name: "Ada", email: "ada@example.com" }
const windows = () => useWorkspaceStore.getState().windows

function hook(config: DomainTableConfig<Row> = CONFIG) {
  return renderHook(() => useRecordWindows(config, (r: Row) => r.name))
}

describe("useRecordWindows", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
  })

  it("opens a detail window titled by the row, not its id", () => {
    const { result } = hook()
    act(() => result.current.onOpen!(ROW))

    expect(windows()).toHaveLength(1)
    expect(windows()[0].kind).toBe("record-detail")
    expect(windows()[0].title).toBe("Ada")
    expect(windows()[0].props).toMatchObject({ domain: "contacts", endpoint: "/contacts", id: "r1" })
  })

  it("focuses rather than duplicating when the same row is opened twice", () => {
    const { result } = hook()
    act(() => result.current.onOpen!(ROW))
    act(() => result.current.onOpen!(ROW))

    expect(windows()).toHaveLength(1)
  })

  it("singularises the title for create", () => {
    const { result } = hook()
    act(() => result.current.onCreate!())
    expect(windows()[0].title).toBe("New contact")
  })

  it("opens an edit window keyed per row", () => {
    const { result } = hook()
    act(() => result.current.onEdit!(ROW))
    act(() => result.current.onEdit!({ ...ROW, id: "r2" }))

    expect(windows()).toHaveLength(2)
    expect(windows().every((w) => w.kind === "record-edit")).toBe(true)
  })

  it("passes row ids to the confirm dialog by default", () => {
    const { result } = hook()
    act(() => result.current.onDelete([ROW, { ...ROW, id: "r2" }]))

    const win = windows()[0]
    expect(win.kind).toBe("confirm")
    expect(win.props).toMatchObject({ ids: ["r1", "r2"], endpoint: "/contacts", destructive: true })
    expect(win.props?.message).toBe("Delete 2 contacts?")
  })

  it("passes the deleteKey when the domain deletes by something other than id", () => {
    // /system/notifications/suppressions/:email — the row id is a uuid the
    // path will not accept.
    const { result } = hook({ ...CONFIG, deleteKey: (r) => r.email })
    act(() => result.current.onDelete([ROW]))

    expect(windows()[0].props).toMatchObject({ ids: ["ada@example.com"] })
  })

  it("opens one confirm dialog per selection, not per click", () => {
    const { result } = hook()
    act(() => result.current.onDelete([ROW]))
    act(() => result.current.onDelete([ROW]))
    expect(windows()).toHaveLength(1)

    act(() => result.current.onDelete([ROW, { ...ROW, id: "r2" }]))
    expect(windows()).toHaveLength(2)
  })
})

describe("useRecordWindows without a form spec", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
  })

  it("withholds open, create and edit entirely", () => {
    // Every record window renders RECORD_FORMS[domain]; a domain without one
    // would open a window reading "No form is configured for …". Files is
    // exactly that: no create, no edit, no form — and so no row opener.
    const { result } = renderHook(() =>
      useRecordWindows({ ...CONFIG, key: "files" }, (r: Row) => r.name),
    )

    expect(result.current.onOpen).toBeUndefined()
    expect(result.current.onCreate).toBeUndefined()
    expect(result.current.onEdit).toBeUndefined()
  })

  it("seeds detail and edit from the row when there is no item endpoint", () => {
    // Eleven endpoints have a list route and no GET /:id — every vocabulary
    // list, budgets, accounts, recurring, fx-rates, suppressions, time
    // entries, project members. Verified live: each 404s on the item route,
    // so a window that fetched would fail on open.
    const { result } = hook({ ...CONFIG, noItemEndpoint: true })

    act(() => result.current.onOpen!(ROW))
    expect(windows()[0].props).toMatchObject({ seed: { id: "r1", name: "Ada" } })

    act(() => result.current.onEdit!(ROW))
    expect(windows()[1].props).toMatchObject({ seed: { id: "r1", name: "Ada" } })
  })

  it("does not seed a domain whose item endpoint exists", () => {
    const { result } = hook()
    act(() => result.current.onOpen!(ROW))
    expect(windows()[0].props).not.toHaveProperty("seed")
  })

  it("still offers delete, which needs no form", () => {
    const { result } = renderHook(() =>
      useRecordWindows({ ...CONFIG, key: "files" }, (r: Row) => r.name),
    )
    act(() => result.current.onDelete([ROW]))
    expect(windows()[0].kind).toBe("confirm")
  })
})
