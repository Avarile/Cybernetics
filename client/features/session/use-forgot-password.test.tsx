import { act, renderHook, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { StateProvider } from "@/lib/swr/provider"
import { useForgotPassword } from "./use-forgot-password"

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

describe("useForgotPassword", () => {
  it("posts the address to the reset endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(null))
    const { result } = renderHook(() => useForgotPassword(), { wrapper: wrapper(fetchImpl) })

    await act(async () => {
      await result.current.request("a@b.c")
    })

    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.test/auth/forgot-password")
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({ email: "a@b.c" })
    expect(result.current.sent).toBe(true)
    expect(result.current.pending).toBe(false)
  })

  it("confirms just the same when the request fails", async () => {
    // The endpoint answers identically for known and unknown addresses, so the
    // UI must not distinguish a rejection either — a form that only confirmed
    // on a 2xx would leak account existence through its own error state.
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "UNKNOWN", message: "boom", statusCode: 500 } }, 500),
    )
    const { result } = renderHook(() => useForgotPassword(), { wrapper: wrapper(fetchImpl) })

    await act(async () => {
      // Must not reject either: the pane awaits this from a submit handler.
      await result.current.request("nobody@nowhere.test")
    })

    expect(result.current.sent).toBe(true)
    expect(result.current.pending).toBe(false)
  })

  it("reports pending while the request is in flight", async () => {
    let release!: (value: Response) => void
    const fetchImpl = vi.fn(
      () => new Promise<Response>((resolve) => { release = resolve }),
    )
    const { result } = renderHook(() => useForgotPassword(), { wrapper: wrapper(fetchImpl) })

    let done!: Promise<void>
    act(() => {
      done = result.current.request("a@b.c")
    })
    await waitFor(() => expect(result.current.pending).toBe(true))
    expect(result.current.sent).toBe(false)

    await act(async () => {
      release(jsonResponse(null))
      await done
    })
    expect(result.current.pending).toBe(false)
    expect(result.current.sent).toBe(true)
  })
})
