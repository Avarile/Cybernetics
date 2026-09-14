import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JsonObject } from "@/lib/state/json"
import { StateProvider } from "@/lib/swr/provider"
import { useViewportStore } from "@/stores/viewport.store"
import { useWorkspaceStore } from "@/stores/workspace.store"
import { DataWindow } from "./data-window"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

const role = vi.hoisted(() => ({ current: "user" as "user" | "admin" }))
vi.mock("@/features/session/use-session", () => ({
  useSession: () => ({
    principal: { id: "u1", kind: "user", role: role.current },
    authed: true,
    settling: false,
    error: null,
  }),
}))

const fetchImpl = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * Stands in for WindowLayer, which feeds a body its props FROM THE STORE on
 * every render. Passing the opening props statically would make `patchProps`
 * look like it did nothing — the store would update and the body would never
 * see it, which is the opposite of how it behaves in the app.
 */
function Harness({ id }: { id: string }) {
  const props = useWorkspaceStore((s) => s.windows.find((w) => w.id === id)?.props)
  return <DataWindow {...props} __windowId={id} />
}

/** The window under test, opened for real so it has a `__windowId` to patch. */
function openAndRender(props: JsonObject = {}) {
  const id = useWorkspaceStore.getState().openWindow({ kind: "data", props })
  const result = render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <Harness id={id} />
      </StateProvider>
    </SWRConfig>,
  )
  return { id, ...result }
}

const propsOf = (id: string) =>
  useWorkspaceStore.getState().windows.find((w) => w.id === id)?.props ?? {}

describe("DataWindow", () => {
  beforeEach(() => {
    role.current = "user"
    localStorage.clear()
    useWorkspaceStore.getState().closeAll()
    useViewportStore.getState().setViewport({ w: 1400, h: 900 })
    fetchImpl.mockReset()
    fetchImpl.mockResolvedValue(json({ data: [], total: 0, page: 1, limit: 20 }))
  })

  it("renders the nav, the breadcrumb and the first domain's first section", async () => {
    openAndRender()

    expect(await screen.findByRole("button", { name: "Contacts" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Files" })).toBeInTheDocument()

    // The section is named twice on purpose, and the two namings are
    // different controls: the breadcrumb says where you are, the tab is how
    // you got there. Asserting on one bare string would pass if either
    // vanished.
    expect(screen.getByRole("tab", { name: "People", selected: true })).toBeInTheDocument()
    const crumb = document.querySelector('[data-slot="breadcrumb-page"]')
    expect(crumb).toHaveTextContent("People")
  })

  it("switches section on a tab click without touching the domain", async () => {
    const { id } = openAndRender()

    await userEvent.click(await screen.findByRole("tab", { name: "Companies" }))

    await waitFor(() => expect(propsOf(id).section).toBe("companies"))
    expect(propsOf(id).domain).toBe("contacts")
  })

  it("keeps reference sections out of the tab row and in the overflow", async () => {
    openAndRender()
    await screen.findByRole("tab", { name: "People" })

    expect(screen.queryByRole("tab", { name: "Types" })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "More sections" }))
    expect(await screen.findByRole("menuitemcheckbox", { name: "Types" })).toBeInTheDocument()
  })

  it("switches domain on a nav click and patches the window props", async () => {
    const { id } = openAndRender()

    await userEvent.click(await screen.findByRole("button", { name: "Files" }))

    await waitFor(() => expect(propsOf(id)).toMatchObject({ domain: "files", section: "files" }))
  })

  it("patches domain AND section together, never the domain alone", async () => {
    // Patching only the domain would leave a section key belonging to the
    // previous domain for resolveLocation to silently correct — a fallback
    // papering over a bug.
    const { id } = openAndRender({ domain: "contacts", section: "people" })

    await userEvent.click(await screen.findByRole("button", { name: "Files" }))

    await waitFor(() => expect(propsOf(id).section).toBe("files"))
    expect(propsOf(id).domain).toBe("files")
  })

  it("falls back for an unknown persisted domain and writes the fallback back", async () => {
    // localStorage is user-writable and survives deploys; isRestorable does
    // not validate props. A retired key must not render a blank pane.
    const { id } = openAndRender({ domain: "no-such-domain", section: "nope" })

    expect(await screen.findByRole("button", { name: "Contacts" })).toBeInTheDocument()
    await waitFor(() =>
      expect(propsOf(id)).toMatchObject({ domain: "contacts", section: "people" }),
    )
  })

  it("issues no further request for the previous section after a domain switch", async () => {
    openAndRender()
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    const contactCalls = () =>
      fetchImpl.mock.calls.filter(([url]) => String(url).includes("/contacts")).length
    const before = contactCalls()

    await userEvent.click(screen.getByRole("button", { name: "Files" }))
    await waitFor(() =>
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/files"))).toBe(true),
    )

    expect(contactCalls()).toBe(before)
  })

  it("survives being rendered without a window id", () => {
    // RecordWindow makes the same allowance: a body can be mounted outside a
    // WindowLayer in tests, and patching a window that does not exist is a
    // no-op rather than a crash.
    expect(() =>
      render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
            <DataWindow />
          </StateProvider>
        </SWRConfig>,
      ),
    ).not.toThrow()
  })
})
