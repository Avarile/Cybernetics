import type { useSWRConfig } from "swr"
import { useTurnStore } from "@/stores/turn.store"
import { useSceneStore } from "@/stores/scene.store"
import { useSessionStore } from "@/stores/session.store"
import { useUploadStore } from "@/stores/upload.store"
import { useWorkspaceStore } from "@/stores/workspace.store"

type Mutator = ReturnType<typeof useSWRConfig>["mutate"]

/**
 * The single choke point for "this session is over".
 *
 * Every client store *and* the server cache are cleared together. Before this
 * existed, sign-out cleared tokens and closed windows while the conversation
 * rail, message history and in-flight uploads stayed resident — so signing in
 * as a different user on the same tab surfaced the previous user's data until
 * the first refetch overwrote it. The rail and message history have since
 * moved to SWR, whose cache eviction (the `mutate` call below) is what clears
 * those now; the client stores below cover what SWR does not own.
 *
 * `mutate` is nullable because the API client can fail auth before the cache
 * bridge has mounted; clearing the stores is still correct in that window.
 */
export function resetClientState(mutate: Mutator | null): void {
  useSessionStore.getState().clear()
  useWorkspaceStore.getState().closeAll()
  // The turn store joins the workspace/upload stores here rather than waiting
  // on a refetch: a stale active conversation, in-flight turn, or optimistic
  // row is exactly the kind of "previous user's data" this function exists to
  // prevent. The rail and stored history are SWR's job now — the cache
  // eviction below (`mutate`) is what clears those.
  useTurnStore.getState().reset()
  useUploadStore.getState().reset()
  useSceneStore.getState().reset()
  void mutate?.(() => true, undefined, { revalidate: false })
}
