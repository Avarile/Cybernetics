import { render, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import { useSessionStore } from "@/stores/session.store"
import { useWorkspaceStore, WORKSPACE_STORAGE_KEY } from "@/stores/workspace.store"
import { useAuthGate } from "./session/use-auth-gate"
import { useStateHydration } from "./state-hydration"

/** The real composition CoreShell uses, minus the 3D canvas and chrome. */
function Shell() {
  const hydrated = useStateHydration()
  useAuthGate(hydrated)
  return <span data-testid="hydrated">{String(hydrated)}</span>
}

function renderShell() {
  return render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={vi.fn() as unknown as typeof fetch}>
        <Shell />
      </StateProvider>
    </SWRConfig>,
  )
}

describe("useStateHydration", () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionStore.getState().clear()
    useWorkspaceStore.getState().closeAll()
  })

  it("resolves true once both persisted stores have rehydrated", async () => {
    const { getByTestId } = renderShell()
    await waitFor(() => expect(getByTestId("hydrated")).toHaveTextContent("true"))
  })

  /**
   * The scenario the ordering constraint exists to prevent: a signed-out
   * mount opens the auth window — a workspace mutation — and `persist` writes
   * after every `setState` with no hydration guard of its own. If that
   * mutation reaches disk before the legacy `cyb.windows` payload has been
   * read and upgraded, the write replaces it with a fresh, empty envelope,
   * destroying the user's only copy of their restored layout.
   */
  it("mounting the shell signed-out does not destroy a legacy cyb.windows payload", async () => {
    // The pre-persist shape: a bare `{ version, windows }` envelope, not the
    // `{ state, version }` shape `persist` writes today.
    localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        windows: [
          {
            id: "w1",
            kind: "contacts",
            title: "Contacts",
            rect: { x: 10, y: 10, w: 400, h: 300 },
            zIndex: 4,
            state: "normal",
            modal: false,
          },
        ],
      }),
    )

    const { getByTestId } = renderShell()

    // The load-bearing assertion: right after `render`, effects have been
    // flushed but the microtask `Promise.all(...).then(setHydrated)` runs in
    // has not — so `hydrated` must still be false, and the gate must not
    // have opened yet. Checking this only AFTER `hydrated` flips true (as an
    // earlier version of this test did) can't fail on a broken ordering
    // guard: by then hydration has already happened no matter what order the
    // hooks fire in.
    expect(getByTestId("hydrated")).toHaveTextContent("false")
    expect(useWorkspaceStore.getState().windows.some((w) => w.kind === "auth")).toBe(false)

    await waitFor(() => expect(getByTestId("hydrated")).toHaveTextContent("true"))
    // The gate reconciles (signed out -> opens "auth") in the same effect
    // flush hydration resolves in; give it a moment to have written to disk.
    await waitFor(() =>
      expect(useWorkspaceStore.getState().windows.some((w) => w.kind === "auth")).toBe(true),
    )

    const stored = JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!)
    // Either still the legacy shape (untouched) or upgraded with the restored
    // window intact — never an empty envelope.
    const windows = stored.windows ?? stored.state?.windows
    expect(windows).toHaveLength(1)
    expect(windows[0].kind).toBe("contacts")
  })
})
