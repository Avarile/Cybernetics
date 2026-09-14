import { render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import type { DomainTableConfig } from "@/components/data-table/types"
import { SectionHost } from "./section-host"
import type { SectionSpec } from "./types"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

interface Row {
  id: string
  name: string
}

const fetchImpl = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const scopedConfig = (projectId: string): DomainTableConfig<Row> => ({
  key: "milestones",
  title: "Milestones",
  endpoint: `/projects/${projectId}/milestones`,
  source: "collection",
  columns: [{ key: "name", header: "Name", cell: (r) => r.name }],
})

const SCOPED: SectionSpec = {
  key: "milestones",
  label: "Milestones",
  body: {
    kind: "scoped-table",
    scope: {
      param: "projectId",
      from: "/projects",
      labelKey: "name",
      placeholder: "Choose a project to see its milestones",
    },
    config: scopedConfig,
    titleOf: (r: Row) => r.name,
  },
}

function tree(node: React.ReactNode) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        {node}
      </StateProvider>
    </SWRConfig>
  )
}

describe("SectionHost — scoped sections", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
    fetchImpl.mockResolvedValue(json([{ id: "m1", name: "Beta launch" }]))
  })

  it("asks for a parent and issues NO request before one is chosen", async () => {
    // An error would be wrong (nothing failed) and an empty table would be a
    // lie (nothing was asked for).
    render(tree(<SectionHost section={SCOPED} />))

    expect(
      await screen.findByText("Choose a project to see its milestones"),
    ).toBeInTheDocument()
    expect(screen.queryByRole("table")).not.toBeInTheDocument()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("fetches the scoped endpoint once a parent is given", async () => {
    render(tree(<SectionHost section={SCOPED} scopeId="p1" />))

    expect(await screen.findByText("Beta launch")).toBeInTheDocument()
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.test/projects/p1/milestones")
  })
})

describe("SectionHost — custom sections", () => {
  beforeEach(() => fetchImpl.mockReset())

  it("renders whatever the section renders", async () => {
    const section: SectionSpec = {
      key: "reports",
      label: "Reports",
      body: { kind: "custom", render: () => <p>A report, not a row set</p> },
    }
    render(tree(<SectionHost section={section} />))
    await waitFor(() => expect(screen.getByText("A report, not a row set")).toBeInTheDocument())
  })
})

describe("SectionHost — form sections", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
  })

  it("loads a singleton resource with no id in the path", async () => {
    fetchImpl.mockResolvedValue(json({ firstName: "Ada", lastName: "Lovelace" }))
    const section: SectionSpec = {
      key: "profile",
      label: "Profile",
      body: { kind: "form", endpoint: "/me/profile", spec: "contacts" },
    }
    render(tree(<SectionHost section={section} />))

    await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Ada"))
    // No `${endpoint}/${id}` composition — the endpoint IS the record.
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.test/me/profile")
  })

  it("says so when no form is configured for the spec key", async () => {
    fetchImpl.mockResolvedValue(json({}))
    const section: SectionSpec = {
      key: "x",
      label: "X",
      body: { kind: "form", endpoint: "/me/profile", spec: "no-such-spec" },
    }
    render(tree(<SectionHost section={section} />))
    expect(await screen.findByText(/No form is configured/)).toBeInTheDocument()
  })
})
