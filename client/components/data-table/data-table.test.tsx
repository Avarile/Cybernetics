import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import { SWRConfig } from "swr"
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

function tableTree(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <DataTable config={CONFIG} {...props} />
      </StateProvider>
    </SWRConfig>
  )
}

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(tableTree(props))
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
      <SWRConfig value={{ provider: () => new Map() }}>
        <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
          <DataTable
            config={{ ...CONFIG, canEdit: false, canDelete: false, canCreate: false }}
          />
        </StateProvider>
      </SWRConfig>,
    )
    await screen.findByText("Alpha")
    expect(screen.queryByRole("button", { name: "Row actions" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /new/i })).not.toBeInTheDocument()
  })

  it("issues one request per distinct query and none per re-render", async () => {
    fetchImpl.mockResolvedValue(page(ROWS))
    const { rerender } = renderTable()
    await screen.findByText("Alpha")

    // Same config, same query — SWR should serve both re-renders from cache.
    rerender(tableTree())
    rerender(tableTree())
    await screen.findByText("Alpha")

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("returns to page one when a filter narrows the list", async () => {
    fetchImpl.mockResolvedValue(page(ROWS, 57))
    renderTable()
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByRole("button", { name: /go to next page/i }))
    await waitFor(() => {
      expect(requestedUrls().some((u) => u.includes("page=2"))).toBe(true)
    })

    // The select trigger's accessible name doesn't resolve in jsdom (its label
    // lives in a Radix-rendered `SelectValue`, not an aria-label), so target
    // the trigger button by its visible text instead of role+name. The text
    // itself has `pointer-events: none`, so click its button ancestor.
    const statusTrigger = screen.getByText("Status: any").closest("button")
    if (!statusTrigger) throw new Error("status select trigger not found")
    await userEvent.click(statusTrigger)
    await userEvent.click(await screen.findByRole("option", { name: "Archived" }))

    await waitFor(() => {
      expect(requestedUrls().some((u) => u.includes("status=archived"))).toBe(true)
    })
    expect(requestedUrls().at(-1)).toContain("page=1")
  })

  it("discards an out-of-order response and shows the latest query's rows", async () => {
    // Regression test for the deleted `requestSeq` ref: the old hook discarded
    // a late response by hand. The claim now is that SWR keys a response to
    // the query that asked for it, so a slow response for an earlier query
    // can never land in a newer query's slot. This test fires two distinct
    // queries before either resolves, resolves them out of order, and checks
    // the table shows the later query's rows regardless.
    let resolveStale!: (r: Response) => void
    let resolveFresh!: (r: Response) => void
    const pendingStale = new Promise<Response>((res) => {
      resolveStale = res
    })
    const pendingFresh = new Promise<Response>((res) => {
      resolveFresh = res
    })

    fetchImpl.mockImplementation((url: string) => {
      if (url.endsWith("search=ab")) return pendingFresh
      if (url.endsWith("search=a")) return pendingStale
      return Promise.resolve(page(ROWS))
    })

    renderTable()
    await screen.findByText("Alpha")

    // One userEvent.type call fires both queries in sequence, back to back,
    // well before either's response arrives.
    await userEvent.type(screen.getByPlaceholderText("Search…"), "ab")

    // The newer query (search=ab) resolves first.
    resolveFresh(page([{ id: "9", name: "Zulu", status: "active" }], 1))
    expect(await screen.findByText("Zulu")).toBeInTheDocument()

    // The stale query (search=a) resolves late — it must not clobber the
    // table now that a newer query is current. There is no positive event to
    // wait for here (correct behaviour is that nothing changes), so give its
    // promise chain a real turn of the event loop before asserting — the same
    // technique `lib/swr/provider.test.tsx` uses to prove a retry never fires.
    resolveStale(page([{ id: "8", name: "Yankee", status: "active" }], 1))
    await new Promise((r) => setTimeout(r, 250))
    expect(screen.queryByText("Yankee")).not.toBeInTheDocument()
    expect(screen.getByText("Zulu")).toBeInTheDocument()
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

describe("DataTable — per-row guards and selection", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
    fetchImpl.mockResolvedValue(page(ROWS))
  })

  it("hides Edit on a row the principal may not edit", async () => {
    // PublicProject.access says what this principal may do to THIS row, so a
    // viewer must not be offered an action that will 403.
    render(
      tableTree({
        config: { ...CONFIG, canEdit: (r: Row) => r.id === "1", canDelete: false },
        onEdit: () => {},
      }),
    )
    await screen.findByText("Alpha")

    const menus = screen.getAllByRole("button", { name: /row actions/i })
    await userEvent.click(menus[0])
    expect(await screen.findByRole("menuitem", { name: /edit/i })).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")

    await userEvent.click(menus[1])
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: /edit/i })).not.toBeInTheDocument(),
    )
  })

  it("renders no row menu at all when every action resolves away", async () => {
    // An empty dropdown is a control that can never do anything.
    render(
      tableTree({
        config: { ...CONFIG, canEdit: () => false, canDelete: () => false },
        onEdit: () => {},
        onDelete: () => {},
      }),
    )
    await screen.findByText("Alpha")
    expect(screen.queryByRole("button", { name: /row actions/i })).not.toBeInTheDocument()
  })

  it("reports a mixed selection honestly on the bulk delete button", async () => {
    const onDelete = vi.fn()
    render(
      tableTree({ config: { ...CONFIG, canDelete: (r: Row) => r.id === "1" }, onDelete }),
    )
    await screen.findByText("Alpha")

    await userEvent.click(screen.getByRole("checkbox", { name: /select all/i }))

    // Two selected, one deletable. Saying "Delete 2" and removing one is the
    // failure this wording exists to prevent.
    const button = await screen.findByRole("button", { name: /delete 1 of 2/i })
    await userEvent.click(button)
    expect(onDelete).toHaveBeenCalledWith([ROWS[0]])
  })

  it("omits checkboxes entirely for a non-selectable table", async () => {
    // Notification preferences: there is no "delete 3 preferences".
    render(tableTree({ config: { ...CONFIG, selectable: false } }))
    await screen.findByText("Alpha")
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
  })

  it("spans the empty state across the full width when not selectable", async () => {
    fetchImpl.mockResolvedValue(page([], 0))
    render(tableTree({ config: { ...CONFIG, selectable: false, canEdit: false, canDelete: false } }))

    const cell = (await screen.findByText("No widgets.")).closest("td")!
    // Two columns, no checkbox column, no actions column.
    expect(cell.getAttribute("colspan")).toBe("2")
  })

  it("right-aligns a numeric column", async () => {
    render(
      tableTree({
        config: {
          ...CONFIG,
          columns: [{ key: "name", header: "Name", cell: (r: Row) => r.name, numeric: true }],
        },
      }),
    )
    const cell = (await screen.findByText("Alpha")).closest("td")!
    expect(cell.className).toContain("tabular-nums")
  })

  it("pages by totalBeforeAccess, not by the post-filter count", async () => {
    // Verified live: /knowledge?limit=20 answers `total: 20,
    // totalBeforeAccess: 186` on EVERY page — `total` is the visible count
    // on this page, capped by limit. Dividing by it gave "Page 1 of 1" for
    // 186 records and stranded the other 166.
    fetchImpl.mockResolvedValue(
      json({ data: ROWS, total: 2, totalBeforeAccess: 186, page: 1, limit: 20 }),
    )
    render(tableTree())

    // 186 / 20 = 10 pages.
    expect(await screen.findByText("Page 1 of 10")).toBeInTheDocument()
  })

  it("reports rows the server dropped from a short non-final page", async () => {
    // 14 of a requested 20 came back, and page 1 is not the last page, so
    // six were filtered out by access after the SQL page was taken.
    const short = Array.from({ length: 14 }, (_, i) => ({
      id: String(i),
      name: `Row ${i}`,
      status: "active",
    }))
    fetchImpl.mockResolvedValue(
      json({ data: short, total: 14, totalBeforeAccess: 186, page: 1, limit: 20 }),
    )
    render(
      tableTree({
        config: {
          ...CONFIG,
          footnote: ({ hiddenOnPage }) =>
            hiddenOnPage ? <p>{hiddenOnPage} hidden on this page</p> : null,
        },
      }),
    )
    expect(await screen.findByText("6 hidden on this page")).toBeInTheDocument()
  })

  it("does not call the end of the collection a hidden row", async () => {
    // The last page is naturally short. Reporting that as "6 hidden" would
    // accuse the server of filtering on every final page of every list.
    fetchImpl.mockResolvedValue(
      json({ data: ROWS, total: 2, totalBeforeAccess: 2, page: 1, limit: 20 }),
    )
    render(
      tableTree({
        config: {
          ...CONFIG,
          footnote: ({ hiddenOnPage }) =>
            hiddenOnPage ? <p>{hiddenOnPage} hidden on this page</p> : null,
        },
      }),
    )
    await screen.findByText("Alpha")
    expect(screen.queryByText(/hidden on this page/)).not.toBeInTheDocument()
  })
})

describe("DataTable — sourced filters", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
  })

  it("populates a filter's options from its source endpoint", async () => {
    fetchImpl.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes("/finance/accounts")
          ? json([{ id: "a1", name: "Current" }])
          : page(ROWS),
      ),
    )

    render(
      tableTree({
        config: {
          ...CONFIG,
          filters: [
            {
              key: "accountId",
              label: "Account",
              source: { endpoint: "/finance/accounts", labelKey: "name" },
            },
          ],
        },
      }),
    )

    await userEvent.click(await screen.findByRole("combobox", { name: "Account" }))
    expect(await screen.findByRole("option", { name: "Current" })).toBeInTheDocument()
  })
})
