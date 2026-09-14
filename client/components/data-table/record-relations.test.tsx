import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import { RecordWindow } from "./record-window"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

const fetchImpl = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function tree(props: Partial<React.ComponentProps<typeof RecordWindow>> = {}) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <RecordWindow domain="contacts" endpoint="/contacts" mode="detail" id="c1" {...props} />
      </StateProvider>
    </SWRConfig>
  )
}

const urls = () => fetchImpl.mock.calls.map(([u]) => String(u))

describe("RecordWindow relations", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
    fetchImpl.mockImplementation((url: string) => {
      if (String(url).includes("/channels")) {
        return Promise.resolve(json([{ id: "ch1", kind: "email", value: "ada@example.com", label: null, isPrimary: true }]))
      }
      if (String(url).includes("/interactions")) {
        return Promise.resolve(json({ data: [], total: 0, page: 1, limit: 20 }))
      }
      return Promise.resolve(json({ id: "c1", firstName: "Ada", displayName: "Ada" }))
    })
  })

  it("renders a tab per relation beside Details", async () => {
    render(tree())
    expect(await screen.findByRole("tab", { name: "Details" })).toBeInTheDocument()
    for (const label of ["Channels", "Relationships", "Interactions"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument()
    }
  })

  it("fetches NOTHING for a relation until its tab is selected", async () => {
    render(tree())
    await screen.findByRole("tab", { name: "Channels" })
    await waitFor(() => expect(urls().some((u) => u.includes("/contacts/c1"))).toBe(true))

    // Four relations eagerly mounted would be four requests for collections
    // the user may never open.
    expect(urls().some((u) => u.includes("/channels"))).toBe(false)

    await userEvent.click(screen.getByRole("tab", { name: "Channels" }))

    await waitFor(() => expect(urls().some((u) => u.includes("/channels"))).toBe(true))
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()
  })

  it("unmounts the previous relation when another tab is chosen", async () => {
    render(tree())
    await userEvent.click(await screen.findByRole("tab", { name: "Channels" }))
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("tab", { name: "Interactions" }))

    await waitFor(() => expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument())
  })

  it("shows no tabs at all while creating — relations need a saved parent", async () => {
    render(tree({ mode: "create", id: undefined }))
    await screen.findByLabelText("First name")
    expect(screen.queryByRole("tab", { name: "Channels" })).not.toBeInTheDocument()
  })

  it("shows no tabs for a domain that declares no relations", async () => {
    fetchImpl.mockResolvedValue(json({ id: "co1", name: "Acme" }))
    render(tree({ domain: "companies", endpoint: "/companies", id: "co1" }))
    await screen.findByLabelText("Name")
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })
})
