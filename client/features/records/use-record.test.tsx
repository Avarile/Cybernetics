import { renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { useRecord } from "./use-record"

const ROW = { id: "1", displayName: "Ada" }

function wrapper(fetcher: (key: readonly unknown[]) => Promise<unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SWRConfig
        value={{
          provider: () => new Map(),
          fetcher,
          shouldRetryOnError: false,
          dedupingInterval: 0,
          // No `keepPreviousData`. It used to be on globally for table
          // pagination and this wrapper mirrored that; it now lives on
          // `useDomainTable` alone, so SWR's default is what `useRecord`
          // actually runs under. The behaviour that turns on it — a null key
          // after a real one — is the last case below, and the global default
          // itself is pinned in lib/swr/provider.test.tsx.
        }}
      >
        {children}
      </SWRConfig>
    )
  }
}

describe("useRecord", () => {
  it("fetches nothing without an id", () => {
    const fetcher = vi.fn()
    const { result } = renderHook(() => useRecord("/contacts", undefined), {
      wrapper: wrapper(fetcher),
    })
    expect(fetcher).not.toHaveBeenCalled()
    expect(result.current.record).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it("returns the record once loaded", async () => {
    const { result } = renderHook(() => useRecord("/contacts", "1"), {
      wrapper: wrapper(async () => ROW),
    })
    await waitFor(() => expect(result.current.record).toEqual(ROW))
  })

  it("clears the record instead of showing the previous one after the id goes away", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id?: string }) => useRecord("/contacts", id),
      { wrapper: wrapper(async () => ROW), initialProps: { id: "1" } as { id?: string } },
    )
    await waitFor(() => expect(result.current.record).toEqual(ROW))

    // SWR's laggy-data ref has no guard for a null key, so under
    // `keepPreviousData` it would keep reporting record "1" here instead of
    // null — a closed detail window's data bleeding into the next one opened.
    // That is why the app-wide default is off.
    rerender({ id: undefined })
    expect(result.current.record).toBeNull()
  })
})
