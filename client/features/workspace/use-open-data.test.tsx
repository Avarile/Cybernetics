import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useViewportStore } from "@/stores/viewport.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useOpenData } from "./use-open-data"

const windows = () => useWorkspaceStore.getState().windows

describe("useOpenData", () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
  })

  it("opens the Data window at the requested domain", () => {
    const { result } = renderHook(() => useOpenData())
    act(() => void result.current("knowledge", "articles"))

    expect(windows()).toHaveLength(1)
    expect(windows()[0].kind).toBe("data")
    expect(windows()[0].props).toMatchObject({ domain: "knowledge", section: "articles" })
  })

  it("re-points an ALREADY OPEN window instead of leaving it where it was", () => {
    // The whole reason this hook exists. `data` is a singleton, so the second
    // openWindow focuses the existing instance and discards its props —
    // without the patch, "take me to this domain" would silently do nothing.
    const { result } = renderHook(() => useOpenData())
    act(() => void result.current("contacts"))
    const first = windows()[0].id

    act(() => void result.current("finance", "invoices"))

    expect(windows()).toHaveLength(1)
    expect(windows()[0].id).toBe(first)
    expect(windows()[0].props).toMatchObject({ domain: "finance", section: "invoices" })
  })

  it("leaves the section alone when none is given", () => {
    const { result } = renderHook(() => useOpenData())
    act(() => void result.current("contacts", "people"))
    act(() => void result.current("contacts"))

    expect(windows()[0].props).toMatchObject({ domain: "contacts", section: "people" })
  })
})
