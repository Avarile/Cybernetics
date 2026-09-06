import { act, renderHook } from "@testing-library/react"
import { SWRConfig } from "swr"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { StateProvider } from "@/lib/swr/provider"
import { useFileDownload } from "./use-file-download"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function wrapper(fetchImpl: ReturnType<typeof vi.fn>) {
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

describe("useFileDownload", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("fetches the presigned url at click time and opens it", async () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ url: "https://s3.test/obj?sig=1" }))

    const { result } = renderHook(() => useFileDownload(), { wrapper: wrapper(fetchImpl) })
    // Nothing is requested until the row action actually runs — the URL is
    // short-lived, so pre-fetching it with the row would hand out dead links.
    expect(fetchImpl).not.toHaveBeenCalled()

    await act(async () => {
      await result.current("f1")
    })

    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.test/files/f1/download-url")
    expect(open).toHaveBeenCalledWith("https://s3.test/obj?sig=1", "_blank", "noopener")
  })

  it("propagates a failure rather than opening a blank tab", async () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "gone", statusCode: 404 } }, 404),
    )

    const { result } = renderHook(() => useFileDownload(), { wrapper: wrapper(fetchImpl) })
    await expect(result.current("f1")).rejects.toThrow("gone")
    expect(open).not.toHaveBeenCalled()
  })

  it("keeps a stable identity across renders", () => {
    const fetchImpl = vi.fn()
    const { result, rerender } = renderHook(() => useFileDownload(), { wrapper: wrapper(fetchImpl) })
    const first = result.current
    rerender()
    // FilesWindow puts this in a `useMemo` dependency array: an identity that
    // changed every render would rebuild the whole table config with it.
    expect(result.current).toBe(first)
  })
})
