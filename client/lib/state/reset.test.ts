import { describe, expect, it, vi } from "vitest"
import { useTurnStore } from "@/stores/turn.store"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { useUploadStore } from "@/stores/upload.store"
import { useSceneStore } from "@/stores/scene.store"
import { resetClientState } from "./reset"

describe("resetClientState", () => {
  it("clears every client store and evicts the whole swr cache", () => {
    useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 60 })
    useWorkspaceStore.getState().openWindow({ kind: "contacts" })
    useUploadStore.getState().add({
      localId: "u", filename: "f", size: 1, mimeType: "text/plain",
      phase: "uploading", percent: 10, ingestable: true,
    })
    useSceneStore.getState().togglePanel()
    // The active conversation, any in-flight turn, and its optimistic rows are
    // exactly the "previous user's data" this function exists to stop leaking
    // across a sign-in. The rail and stored history are SWR's job — the
    // `matcher(...) === true` assertion below covers those, since they are
    // evicted from the cache rather than held in a store.
    useTurnStore.getState().selectConversation("c1")
    useTurnStore.getState().appendOptimistic("hi")
    useTurnStore.getState().beginTurn()

    const mutate = vi.fn()
    resetClientState(mutate)

    expect(useSessionStore.getState().accessToken).toBeNull()
    expect(useSessionStore.getState().refreshToken).toBeNull()
    expect(useWorkspaceStore.getState().windows).toHaveLength(0)
    expect(useUploadStore.getState().items).toHaveLength(0)
    expect(useSceneStore.getState().panelOpen).toBe(true)
    expect(useTurnStore.getState().activeId).toBeNull()
    expect(useTurnStore.getState().optimistic).toHaveLength(0)
    expect(useTurnStore.getState().turn).toBeNull()

    expect(mutate).toHaveBeenCalledTimes(1)
    const [matcher, data, opts] = mutate.mock.calls[0]
    expect(matcher(["anything"])).toBe(true)
    expect(data).toBeUndefined()
    expect(opts).toEqual({ revalidate: false })
  })

  it("still clears the stores when no cache handle is available yet", () => {
    useSessionStore.getState().setTokens({ accessToken: "a", refreshToken: "r", expiresIn: 60 })
    resetClientState(null)
    expect(useSessionStore.getState().accessToken).toBeNull()
  })
})
