import { beforeEach, describe, expect, it } from "vitest"
import { isSettled, useUploadStore } from "./upload.store"

const s = () => useUploadStore.getState()

const item = {
  localId: "a",
  filename: "notes.md",
  size: 12,
  mimeType: "text/markdown",
  phase: "queued" as const,
  percent: 0,
  ingestable: true,
}

describe("upload.store", () => {
  beforeEach(() => s().reset())

  it("adds an item", () => {
    s().add(item)
    expect(s().items).toHaveLength(1)
  })

  it("applies progress to the matching item only", () => {
    s().add(item)
    s().add({ ...item, localId: "b" })
    s().update("a", { phase: "uploading", percent: 40 })

    expect(s().items.find((i) => i.localId === "a")!.percent).toBe(40)
    expect(s().items.find((i) => i.localId === "b")!.percent).toBe(0)
  })

  it("never unsets a fileId once initiate has handed one over", () => {
    s().add(item)
    s().update("a", { phase: "uploading", percent: 10, fileId: "f1" })
    s().update("a", { phase: "processing", percent: 100 })
    expect(s().items[0].fileId).toBe("f1")
  })

  it("keeps a deduplicated flag across later frames", () => {
    s().add(item)
    s().update("a", { phase: "processing", percent: 100, deduplicated: true })
    s().update("a", { phase: "indexed", percent: 100 })
    expect(s().items[0].deduplicated).toBe(true)
  })

  it("lets an explicit deduplicated:false overwrite a prior true", () => {
    s().add(item)
    s().update("a", { phase: "processing", percent: 100, deduplicated: true })
    s().update("a", { phase: "processing", percent: 100, deduplicated: false })
    expect(s().items[0].deduplicated).toBe(false)
  })

  it("lets an explicit empty fileId overwrite a prior value", () => {
    s().add(item)
    s().update("a", { phase: "uploading", percent: 10, fileId: "f1" })
    s().update("a", { phase: "processing", percent: 100, fileId: "" })
    expect(s().items[0].fileId).toBe("")
  })

  it("clears only settled items", () => {
    s().add(item)
    s().add({ ...item, localId: "b", phase: "indexed" })
    s().add({ ...item, localId: "c", phase: "failed" })
    s().clearSettled()
    expect(s().items.map((i) => i.localId)).toEqual(["a"])
  })

  it("removes one item by id", () => {
    s().add(item)
    s().remove("a")
    expect(s().items).toHaveLength(0)
  })

  it("classifies terminal phases as settled", () => {
    expect(isSettled("indexed")).toBe(true)
    expect(isSettled("failed")).toBe(true)
    expect(isSettled("uploading")).toBe(false)
  })
})
