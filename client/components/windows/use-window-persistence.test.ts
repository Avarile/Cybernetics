import { beforeEach, describe, expect, it } from "vitest"
import type { WindowInstance } from "@/lib/windows/types"
import { useWorkspaceStore } from "@/stores/workspace.store"
import {
  readPersistedWindows,
  serialisePersistedWindows,
} from "./use-window-persistence"

const s = () => useWorkspaceStore.getState()

function instance(over: Partial<WindowInstance> = {}): WindowInstance {
  return {
    id: "w1",
    kind: "terminal",
    title: "Terminal",
    rect: { x: 10, y: 20, w: 600, h: 400 },
    zIndex: 2,
    state: "normal",
    modal: false,
    ...over,
  }
}

describe("window persistence", () => {
  beforeEach(() => {
    localStorage.clear()
    s().closeAll()
    s().setViewport({ w: 1400, h: 900 })
  })

  it("round-trips a normal window", () => {
    const raw = serialisePersistedWindows([instance()])
    const back = readPersistedWindows(raw)
    expect(back).toHaveLength(1)
    expect(back[0].kind).toBe("terminal")
    expect(back[0].rect).toEqual({ x: 10, y: 20, w: 600, h: 400 })
  })

  it("never persists a modal window", () => {
    const raw = serialisePersistedWindows([instance({ kind: "auth", modal: true })])
    expect(readPersistedWindows(raw)).toEqual([])
  })

  it("never persists a record-* window", () => {
    const raw = serialisePersistedWindows([instance({ kind: "record-edit" })])
    expect(readPersistedWindows(raw)).toEqual([])
  })

  it("returns nothing for absent storage", () => {
    expect(readPersistedWindows(null)).toEqual([])
  })

  it("survives malformed JSON", () => {
    expect(readPersistedWindows("{not json")).toEqual([])
  })

  it("rejects a payload from a different schema version", () => {
    const raw = JSON.stringify({ version: 999, windows: [instance()] })
    expect(readPersistedWindows(raw)).toEqual([])
  })

  it("drops a window whose kind is no longer registered", () => {
    // `tags` is a valid WindowKind but has no registry entry until Phase 4;
    // restoring it would put a frame on screen with nothing inside.
    const raw = JSON.stringify({ version: 1, windows: [instance({ kind: "tags" })] })
    expect(readPersistedWindows(raw)).toEqual([])
  })

  it("drops an entry with a malformed rect", () => {
    const bad = { ...instance(), rect: { x: 1, y: 2 } }
    const raw = JSON.stringify({ version: 1, windows: [bad] })
    expect(readPersistedWindows(raw)).toEqual([])
  })

  it("drops an entry missing required fields", () => {
    const raw = JSON.stringify({ version: 1, windows: [{ id: "x" }] })
    expect(readPersistedWindows(raw)).toEqual([])
  })

  it("keeps the good entries and drops only the bad ones", () => {
    const raw = JSON.stringify({
      version: 1,
      windows: [instance(), { id: "junk" }, instance({ id: "w2", kind: "voice" })],
    })
    expect(readPersistedWindows(raw).map((w) => w.id)).toEqual(["w1", "w2"])
  })

  it("hydrate restores the layout and keeps z-order sane", () => {
    s().hydrate([
      instance({ id: "a", zIndex: 3 }),
      instance({ id: "b", kind: "voice", zIndex: 7 }),
    ])
    expect(s().windows).toHaveLength(2)
    // A newly opened window must land above everything restored.
    const fresh = s().openWindow({ kind: "settings" })
    expect(s().windows.find((w) => w.id === fresh)!.zIndex).toBeGreaterThan(7)
  })

  it("a minimised window survives the round trip still minimised", () => {
    const raw = serialisePersistedWindows([instance({ state: "minimised" })])
    expect(readPersistedWindows(raw)[0].state).toBe("minimised")
  })
})
