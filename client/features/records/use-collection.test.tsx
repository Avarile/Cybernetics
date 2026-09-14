import { renderHook, waitFor, act } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import type { DomainTableConfig } from "@/components/data-table/types"
import { useDomainTable } from "./use-domain-table"

interface Row {
  id: string
  name: string
  kind: string
}

const ROWS: Row[] = [
  { id: "1", name: "Current", kind: "bank" },
  { id: "2", name: "Savings", kind: "bank" },
  { id: "3", name: "Petty cash", kind: "cash" },
]

const COLLECTION: DomainTableConfig<Row> = {
  key: "accounts",
  title: "Accounts",
  endpoint: "/finance/accounts",
  source: "collection",
  searchable: true,
  columns: [
    { key: "name", header: "Name", cell: (r) => r.name },
    { key: "kind", header: "Kind", cell: (r) => r.kind },
  ],
  filters: [{ key: "kind", label: "Kind", options: [{ value: "cash", label: "Cash" }] }],
}

const PAGED: DomainTableConfig<Row> = { ...COLLECTION, source: undefined, endpoint: "/contacts" }

const fetchImpl = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        {children}
      </StateProvider>
    </SWRConfig>
  )
}

describe("useDomainTable with source: collection", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
  })

  it("fetches the bare array once and pages it in memory", async () => {
    fetchImpl.mockResolvedValue(json(ROWS))
    const { result } = renderHook(() => useDomainTable(COLLECTION), { wrapper })

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.rows).toHaveLength(3)
    expect(result.current.total).toBe(3)

    act(() => result.current.setQuery({ limit: 2 }))
    await waitFor(() => expect(result.current.rows).toHaveLength(2))

    // Paging is a memo over data already held — no second request.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("requests the collection endpoint with no query string", async () => {
    fetchImpl.mockResolvedValue(json(ROWS))
    renderHook(() => useDomainTable(COLLECTION), { wrapper })

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.test/finance/accounts")
  })

  it("filters and searches without hitting the network", async () => {
    fetchImpl.mockResolvedValue(json(ROWS))
    const { result } = renderHook(() => useDomainTable(COLLECTION), { wrapper })
    await waitFor(() => expect(result.current.status).toBe("ready"))

    act(() => result.current.setFilter("kind", "cash"))
    await waitFor(() => expect(result.current.total).toBe(1))

    act(() => result.current.setFilter("kind", ""))
    act(() => result.current.setQuery({ search: "sav" }))
    await waitFor(() => expect(result.current.rows.map((r) => r.name)).toEqual(["Savings"]))

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("reports a non-array response as an error, not as an empty list", async () => {
    // An empty table is indistinguishable from a legitimately empty domain —
    // exactly how /files reading `items` went unnoticed.
    fetchImpl.mockResolvedValue(json({ data: ROWS, total: 3 }))
    const { result } = renderHook(() => useDomainTable(COLLECTION), { wrapper })

    await waitFor(() => expect(result.current.status).toBe("error"))
    expect(result.current.error).toMatch(/unexpected response shape/i)
  })

  it("surfaces a transport failure", async () => {
    fetchImpl.mockResolvedValue(json({ message: "nope" }, 500))
    const { result } = renderHook(() => useDomainTable(COLLECTION), { wrapper })
    await waitFor(() => expect(result.current.status).toBe("error"))
  })
})

describe("useDomainTable dispatch", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
  })

  it("issues no collection request for a paged config", async () => {
    fetchImpl.mockResolvedValue(json({ data: ROWS, total: 3, page: 1, limit: 20 }))
    const { result } = renderHook(() => useDomainTable(PAGED), { wrapper })

    await waitFor(() => expect(result.current.status).toBe("ready"))
    // The inactive branch is keyed null: one request, and it is the list one.
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/contacts?")
  })

  it("issues no list request for a collection config", async () => {
    fetchImpl.mockResolvedValue(json(ROWS))
    const { result } = renderHook(() => useDomainTable(COLLECTION), { wrapper })

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("?page=")
  })

  it("reads a `rows` envelope — /finance/budgets", async () => {
    // The third spelling. Before rowsOf grew this branch the table showed
    // "3 rows" over an empty body.
    fetchImpl.mockResolvedValue(json({ rows: ROWS, total: 3 }))
    const { result } = renderHook(
      () => useDomainTable({ ...PAGED, endpoint: "/finance/budgets" }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.status).toBe("ready"))
    expect(result.current.rows).toHaveLength(3)
    expect(result.current.total).toBe(3)
  })
})
