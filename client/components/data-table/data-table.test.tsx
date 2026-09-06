import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiProvider } from "@/lib/api/provider"
import { DataTable } from "./data-table"
import type { DomainTableConfig } from "./types"

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }))

interface Row {
  id: string
  name: string
  status: string
}

const CONFIG: DomainTableConfig<Row> = {
  key: "widgets",
  title: "Widgets",
  endpoint: "/widgets",
  searchable: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  emptyMessage: "No widgets.",
  tabs: [
    { value: "all", label: "All", query: {} },
    { value: "active", label: "Active", query: { status: "active" } },
  ],
  filters: [
    {
      key: "status",
      label: "Status",
      options: [{ value: "archived", label: "Archived" }],
    },
  ],
  columns: [
    { key: "name", header: "Name", cell: (r) => r.name, hideable: false },
    { key: "status", header: "Status", cell: (r) => r.status },
  ],
}

const fetchImpl = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function page(rows: Row[], total = rows.length) {
  return json({ data: rows, total, page: 1, limit: 20 })
}

const ROWS: Row[] = [
  { id: "1", name: "Alpha", status: "active" },
  { id: "2", name: "Beta", status: "archived" },
]

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <ApiProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
      <DataTable config={CONFIG} {...props} />
    </ApiProvider>,
  )
}

/** The path+query of every list request made so far. */
function requestedUrls(): string[] {
  return fetchImpl.mock.calls.map((c) => String(c[0]).replace("https://api.test", ""))
}

describe("DataTable", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", fetchImpl)
  })

  it("requests page 1 at the default limit and renders the rows", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    renderTable()

    expect(await screen.findByText("Alpha")).toBeInTheDocument()
    expect(screen.getByText("Beta")).toBeInTheDocument()
    expect(requestedUrls()[0]).toContain("/widgets?page=1&limit=20")
  })

  it("shows the total row count", async () => {
    fetchImpl.mockResolvedValue(page(ROWS, 57))
    renderTable()
    expect(await screen.findByText("57 rows")).toBeInTheDocument()
  })

  it("reports the page count from the server total, not the rows on screen", async () => {
    // The whole point of server pagination: 2 rows fetched, 57 total, 3 pages.
    fetchImpl.mockResolvedValue(page(ROWS, 57))
    renderTable()
    expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument()
  })

  it("distinguishes empty from failed", async () => {
    fetchImpl.mockResolvedValue(page([], 0))
    const { unmount } = renderTable()
    expect(await screen.findByText("No widgets.")).toBeInTheDocument()
    unmount()

    vi.clearAllMocks()
    fetchImpl.mockResolvedValue(
      json({ error: { code: "UNKNOWN", message: "boom", statusCode: 500 } }, 500),
    )
    renderTable()
    expect(await screen.findByRole("alert")).toHaveTextContent("boom")
  })

  it("switching tab sends that tab's query and returns to page 1", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    renderTable()
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByRole("tab", { name: "Active" }))

    await waitFor(() => {
      expect(requestedUrls().some((u) => u.includes("status=active"))).toBe(true)
    })
    expect(requestedUrls().at(-1)).toContain("page=1")
  })

  it("typing in search sends the term", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    renderTable()
    await screen.findByText("Alpha")

    await userEvent.type(screen.getByPlaceholderText("Search…"), "alp")

    await waitFor(() => {
      expect(requestedUrls().some((u) => u.includes("search=alp"))).toBe(true)
    })
  })

  it("paging forward requests the next page", async () => {
    fetchImpl.mockResolvedValue(page(ROWS, 57))
    renderTable()
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByRole("button", { name: /go to next page/i }))

    await waitFor(() => {
      expect(requestedUrls().some((u) => u.includes("page=2"))).toBe(true)
    })
  })

  it("disables the pager at the ends", async () => {
    fetchImpl.mockResolvedValue(page(ROWS, 2))
    renderTable()
    await screen.findByText("Alpha")
    expect(screen.getByRole("button", { name: /go to previous page/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /go to next page/i })).toBeDisabled()
  })

  it("selecting rows shows a count and a bulk delete", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    const onDelete = vi.fn()
    renderTable({ onDelete })
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByLabelText("Select row 1"))
    expect(screen.getByText("1 of 2 row(s) selected.")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: /delete 1/i }))
    expect(onDelete).toHaveBeenCalledWith([ROWS[0]])
  })

  it("select-all covers every row on the page", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    renderTable({ onDelete: vi.fn() })
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByLabelText("Select all"))
    expect(screen.getByText("2 of 2 row(s) selected.")).toBeInTheDocument()
  })

  it("hides a column through the Columns menu", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    renderTable()
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByRole("button", { name: /columns/i }))
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Status" }))

    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: "Status" })).not.toBeInTheDocument()
    })
    // the non-hideable column is still there
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument()
  })

  it("omits a non-hideable column from the Columns menu", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    renderTable()
    await screen.findByText("Alpha")
    await userEvent.click(screen.getByRole("button", { name: /columns/i }))
    expect(screen.queryByRole("menuitemcheckbox", { name: "Name" })).not.toBeInTheDocument()
  })

  it("fires onCreate from the New button", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    const onCreate = vi.fn()
    renderTable({ onCreate })
    await screen.findByText("Alpha")
    await userEvent.click(screen.getByRole("button", { name: /new/i }))
    expect(onCreate).toHaveBeenCalled()
  })

  it("fires onOpen when a row is clicked, but not from the checkbox", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    const onOpen = vi.fn()
    renderTable({ onOpen })
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByLabelText("Select row 1"))
    expect(onOpen).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText("Alpha"))
    expect(onOpen).toHaveBeenCalledWith(ROWS[0])
  })

  it("hides row actions entirely for a read-only domain", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    render(
      <ApiProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <DataTable
          config={{ ...CONFIG, canEdit: false, canDelete: false, canCreate: false }}
        />
      </ApiProvider>,
    )
    await screen.findByText("Alpha")
    expect(screen.queryByRole("button", { name: "Row actions" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /new/i })).not.toBeInTheDocument()
  })
})

describe("list envelope shape", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", fetchImpl)
  })

  it("reads rows from `data` (contacts, knowledge, projects, …)", async () => {
    fetchImpl.mockResolvedValue(json({ data: ROWS, total: 2, page: 1, limit: 20 }))
    renderTable()
    expect(await screen.findByText("Alpha")).toBeInTheDocument()
  })

  it("reads rows from `items` (file-processor's spelling)", async () => {
    // Regression: /files returns `items`, not `data`. Against a live API the
    // table showed "49 rows / Page 1 of 3" in the footer while the body
    // rendered the empty state, because `data` was undefined.
    fetchImpl.mockResolvedValue(json({ items: ROWS, total: 2, page: 1, limit: 20 }))
    renderTable()
    expect(await screen.findByText("Alpha")).toBeInTheDocument()
    expect(screen.queryByText("No widgets.")).not.toBeInTheDocument()
  })

  it("still shows the empty state when both keys are absent", async () => {
    fetchImpl.mockResolvedValue(json({ total: 0, page: 1, limit: 20 }))
    renderTable()
    expect(await screen.findByText("No widgets.")).toBeInTheDocument()
  })
})
