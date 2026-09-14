import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import { useLookup } from "./use-lookup"

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

const ACCOUNTS = [
  { id: "a1", name: "Current" },
  { id: "a2", name: "Savings" },
]

describe("useLookup", () => {
  beforeEach(() => {
    fetchImpl.mockReset()
  })

  it("resolves ids to labels from a bare array", async () => {
    fetchImpl.mockResolvedValue(json(ACCOUNTS))
    const { result } = renderHook(() => useLookup("/finance/accounts"), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.label("a1")).toBe("Current")
    expect(result.current.options).toEqual([
      { value: "a1", label: "Current" },
      { value: "a2", label: "Savings" },
    ])
  })

  it("resolves from a paged envelope too", async () => {
    fetchImpl.mockResolvedValue(json({ data: ACCOUNTS, total: 2, page: 1, limit: 100 }))
    const { result } = renderHook(() => useLookup("/projects"), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.label("a2")).toBe("Savings")
  })

  it("asks for one capped page", async () => {
    fetchImpl.mockResolvedValue(json(ACCOUNTS))
    renderHook(() => useLookup("/projects"), { wrapper })

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.test/projects?limit=100")
  })

  it("degrades an unresolved id to a short form rather than guessing", async () => {
    fetchImpl.mockResolvedValue(json(ACCOUNTS))
    const { result } = renderHook(() => useLookup("/finance/accounts"), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.label("deadbeef-0000-0000-0000-000000000000")).toBe("deadbeef")
    expect(result.current.has("deadbeef-0000-0000-0000-000000000000")).toBe(false)
  })

  it("renders a dash for null and empty ids", async () => {
    fetchImpl.mockResolvedValue(json(ACCOUNTS))
    const { result } = renderHook(() => useLookup("/finance/accounts"), { wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.label(null)).toBe("—")
    expect(result.current.label(undefined)).toBe("—")
    expect(result.current.label("")).toBe("—")
  })

  it("flags truncation when the source has more rows than one page", async () => {
    // A silently incomplete filter dropdown reads as "my project is missing",
    // not as "there are more than 100".
    fetchImpl.mockResolvedValue(json({ data: ACCOUNTS, total: 412, page: 1, limit: 100 }))
    const { result } = renderHook(() => useLookup("/projects"), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.truncated).toBe(true)
  })

  it("does not flag truncation when the page holds everything", async () => {
    fetchImpl.mockResolvedValue(json({ data: ACCOUNTS, total: 2, page: 1, limit: 100 }))
    const { result } = renderHook(() => useLookup("/projects"), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.truncated).toBe(false)
  })

  it("shares one request between consumers of the same endpoint", async () => {
    // The Account column, the Account filter and the Account form field must
    // not be three requests.
    fetchImpl.mockResolvedValue(json(ACCOUNTS))
    const { result } = renderHook(
      () => [useLookup("/finance/accounts"), useLookup("/finance/accounts")] as const,
      { wrapper },
    )

    await waitFor(() => expect(result.current[0].isLoading).toBe(false))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.current[1].label("a1")).toBe("Current")
  })

  it("falls back to a short id when the label field is blank", async () => {
    fetchImpl.mockResolvedValue(json([{ id: "abcdefgh-1", name: "" }]))
    const { result } = renderHook(() => useLookup("/finance/accounts"), { wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.label("abcdefgh-1")).toBe("abcdefgh")
  })
})
