import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import useSWR from "swr"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { initialQuery } from "@/components/data-table/query"
import { keys, scopes } from "./keys"
import { useInvalidate } from "./use-invalidate"

function wrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig value={{ provider: () => new Map(), fetcher, dedupingInterval: 0 }}>
        {children}
      </SWRConfig>
    )
  }
}

describe("useInvalidate", () => {
  it("revalidates every cached key under the prefix, and nothing outside it", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/contacts", q))
        useSWR(keys.list("/contacts", { ...q, page: 2 }))
        useSWR(keys.list("/files", q))
        return useInvalidate()
      },
      { wrapper: wrapper(fetcher) },
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    fetcher.mockClear()

    await result.current(scopes.allLists("/contacts"))

    // Both /contacts pages refetched; /files untouched.
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    const refetched = fetcher.mock.calls.map((c) => (c[0] as unknown[])[1])
    expect(refetched).toEqual(["/contacts", "/contacts"])
  })

  it("matches nothing for a prefix no cached key carries", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 })
    const { result } = renderHook(
      () => {
        useSWR(keys.list("/contacts", initialQuery()))
        return useInvalidate()
      },
      { wrapper: wrapper(fetcher) },
    )

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    fetcher.mockClear()

    await result.current(scopes.allLists("/nonexistent"))
    expect(fetcher).not.toHaveBeenCalled()
  })
})
