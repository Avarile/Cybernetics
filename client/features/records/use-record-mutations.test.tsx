import { act, renderHook, waitFor } from "@testing-library/react"
import useSWR, { SWRConfig } from "swr"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { initialQuery } from "@/components/data-table/query"
import { ApiError } from "@/lib/api/errors"
import { keys } from "@/lib/swr/keys"
import { StateProvider } from "@/lib/swr/provider"
import { useRecordMutations } from "./use-record-mutations"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/**
 * A `fetchImpl` that answers every method truthfully enough for SWR to resolve,
 * except DELETE on id "2", which always fails — that's what exercises the
 * partial-failure path in `remove`.
 */
function makeFetchImpl() {
  return vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    if (method === "DELETE" && (url as string).endsWith("/2")) {
      return Promise.resolve(
        jsonResponse({ error: { code: "UNKNOWN", message: "boom", statusCode: 500 } }, 500),
      )
    }
    if (method === "GET") {
      return Promise.resolve(jsonResponse({ data: [], total: 0, page: 1, limit: 20 }))
    }
    return Promise.resolve(jsonResponse({ ok: true }))
  })
}

function getCalls(fetchImpl: ReturnType<typeof makeFetchImpl>, method: string, urlIncludes: string) {
  return fetchImpl.mock.calls.filter(([url, init]) => {
    const rawInit = init as RequestInit | undefined
    const m = rawInit?.method ?? "GET"
    return m === method && (url as string).includes(urlIncludes)
  })
}

// Mirrors production (`StateProvider`'s own SWRConfig) rather than a bespoke
// config: `keepPreviousData` and the rest of that config have already caused
// real bugs when a test's own SWRConfig quietly diverged from it. The only
// thing overridden is `provider`, so each test gets an isolated cache.
function wrapper(fetchImpl: ReturnType<typeof makeFetchImpl>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map() }}>
        <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
          {children}
        </StateProvider>
      </SWRConfig>
    )
  }
}

describe("useRecordMutations", () => {
  it("invalidates every cached page of the domain after a create", async () => {
    const fetchImpl = makeFetchImpl()
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/contacts", q))
        useSWR(keys.list("/contacts", { ...q, page: 2 }))
        return useRecordMutations("/contacts")
      },
      { wrapper: wrapper(fetchImpl) },
    )

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/contacts").length).toBe(2))
    fetchImpl.mockClear()

    await act(async () => {
      await result.current.create({ name: "Ada" })
    })

    expect(getCalls(fetchImpl, "POST", "/contacts").length).toBe(1)
    // Both cached pages refetched — this is the assertion a missing
    // `invalidate(scopes.allLists(...))` call would fail.
    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/contacts").length).toBe(2))
  })

  it("invalidates the record and the lists after an update", async () => {
    const fetchImpl = makeFetchImpl()
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/contacts", q))
        useSWR(keys.record("/contacts", "1"))
        return useRecordMutations("/contacts")
      },
      { wrapper: wrapper(fetchImpl) },
    )

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/contacts").length).toBe(2))
    fetchImpl.mockClear()

    await act(async () => {
      await result.current.update("1", { name: "Ada 2" })
    })

    expect(getCalls(fetchImpl, "PATCH", "/contacts/1").length).toBe(1)
    // One GET for the re-fetched list, one for the re-fetched record.
    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/contacts").length).toBe(2))
  })

  it("reports partial failure honestly when some deletes reject", async () => {
    const fetchImpl = makeFetchImpl()

    const { result } = renderHook(() => useRecordMutations("/contacts"), {
      wrapper: wrapper(fetchImpl),
    })

    let outcome: Awaited<ReturnType<typeof result.current.remove>> | undefined
    await act(async () => {
      outcome = await result.current.remove(["1", "2", "3"])
    })

    expect(outcome?.deleted).toBe(2)
    expect(outcome?.failed).toBe(1)
    expect(outcome?.firstError).toBeInstanceOf(ApiError)
    expect((outcome?.firstError as ApiError).message).toBe("boom")
    expect(getCalls(fetchImpl, "DELETE", "/contacts/").length).toBe(3)
  })

  it("leaves another domain's cache untouched", async () => {
    const fetchImpl = makeFetchImpl()
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/files", q))
        return useRecordMutations("/contacts")
      },
      { wrapper: wrapper(fetchImpl) },
    )

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files").length).toBe(1))
    fetchImpl.mockClear()

    await act(async () => {
      await result.current.create({ name: "Ada" })
    })

    expect(getCalls(fetchImpl, "POST", "/contacts").length).toBe(1)
    // The /files list is never touched by a /contacts mutation.
    expect(getCalls(fetchImpl, "GET", "/files").length).toBe(0)
  })
})
