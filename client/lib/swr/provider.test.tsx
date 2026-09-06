import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import useSWR, { SWRConfig } from "swr"
import { StateProvider, useApi } from "./provider"
import { keys } from "./keys"

/** Reads the same key as `Probe`, but lets the test drop it to null. */
function TogglingProbe({ on }: { on: boolean }) {
  const { data } = useSWR(on ? keys.session() : null)
  return <span data-testid="email">{(data as { email?: string } | undefined)?.email ?? "none"}</span>
}

function Probe() {
  const { data } = useSWR(keys.session())
  const { client, auth } = useApi()
  return (
    <div>
      <span data-testid="email">{(data as { email?: string } | undefined)?.email ?? "none"}</span>
      <span data-testid="wired">{client && auth ? "yes" : "no"}</span>
    </div>
  )
}

describe("StateProvider", () => {
  it("serves swr reads through the api client", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", kind: "user", email: "a@b.c" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    render(
      // Each test gets its own cache: the default SWR cache is a module-level
      // singleton, and both tests here read the same ["session"] key. Without
      // isolation, the second test's mount would dedupe against the first
      // test's still-fresh cache entry and never call its own fetcher.
      <SWRConfig value={{ provider: () => new Map() }}>
        <StateProvider baseUrl="http://api.test" fetchImpl={fetchImpl}>
          <Probe />
        </StateProvider>
      </SWRConfig>,
    )

    expect(screen.getByTestId("wired")).toHaveTextContent("yes")
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("a@b.c"))
    expect(fetchImpl.mock.calls[0][0]).toBe("http://api.test/auth/me")
  })

  it("does not keep previous data app-wide, so a key going null clears its hook", async () => {
    // This default used to point the other way: `keepPreviousData: true` was
    // set here so `useDomainTable` got pagination smoothing, and every hook
    // whose key identifies WHICH entity is on screen had to remember to opt
    // out — three of them didn't, producing a cross-user principal leak and
    // "New chat" showing the previous transcript. SWR's laggy-data ref has no
    // guard for a null key, which is what makes a null key the cheapest way to
    // detect the setting from the outside. `useDomainTable` now opts in for
    // itself; nothing inherits it.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "u1", kind: "user", email: "a@b.c" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )

    const { rerender } = render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <StateProvider baseUrl="http://api.test" fetchImpl={fetchImpl}>
          <TogglingProbe on />
        </StateProvider>
      </SWRConfig>,
    )
    await waitFor(() => expect(screen.getByTestId("email")).toHaveTextContent("a@b.c"))

    rerender(
      <SWRConfig value={{ provider: () => new Map() }}>
        <StateProvider baseUrl="http://api.test" fetchImpl={fetchImpl}>
          <TogglingProbe on={false} />
        </StateProvider>
      </SWRConfig>,
    )
    expect(screen.getByTestId("email")).toHaveTextContent("none")
  })

  it("does not retry a failed read, so the refresh latch is never raced", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
    )

    render(
      // Without a fast errorRetryInterval, SWR's default retry delay is
      // 2500-7500ms (~~((Math.random()+0.5) * (1<<retryCount)) *
      // errorRetryInterval, interval defaulting to 5000ms) — far longer than
      // this test can afford to wait, so it would pass whether or not
      // shouldRetryOnError actually suppresses the retry. The override below
      // makes a would-be retry arrive well inside the wait, so the assertion
      // is actually exercising StateProvider's `shouldRetryOnError: false`.
      // Nested SWRConfig merges: this outer interval is inherited while
      // StateProvider's inner shouldRetryOnError: false still wins.
      <SWRConfig value={{ provider: () => new Map(), errorRetryInterval: 10 }}>
        <StateProvider baseUrl="http://api.test" fetchImpl={fetchImpl}>
          <Probe />
        </StateProvider>
      </SWRConfig>,
    )

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 250))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
