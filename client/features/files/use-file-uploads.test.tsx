import { act, renderHook, waitFor } from "@testing-library/react"
import useSWR, { SWRConfig } from "swr"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import { initialQuery } from "@/components/data-table/query"
import { keys } from "@/lib/swr/keys"
import { StateProvider } from "@/lib/swr/provider"
import { useUploadStore } from "@/stores/upload.store"
import { useFileUploads } from "./use-file-uploads"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** jsdom has no real File constructor quirks; this is enough for the flow. */
function fakeFile(name = "a.pdf", type = "application/pdf", body = "hello") {
  return new File([body], name, { type })
}

/**
 * Answers `POST /files` (initiate) with a dedup response — no `upload`
 * target — so `uploadFile` never touches `XMLHttpRequest`, and
 * `GET /files/f-<name>` (poll) as already AVAILABLE, so there is no polling
 * delay either. Both are what let these tests stay synchronous instead of
 * racing real timers.
 *
 * The fileId is derived from the filename (`a.pdf` → `f-a`) rather than
 * fixed, so a batch of several files can be told apart by the initiate and
 * poll handlers below.
 *
 * `initiateStatus` fails every initiate call; `initiateFailFilenames` fails
 * only the named ones, so one batch can mix successes and failures.
 * `pollStatus` lets a test reach `failed` via a post-initiate cause (a
 * quarantine discovered while polling) rather than an initiate rejection —
 * that path still hands the file a `fileId` before it fails.
 */
function makeFetchImpl({
  initiateStatus = 200,
  initiateFailFilenames = [],
  pollStatus = "AVAILABLE",
}: {
  initiateStatus?: number
  initiateFailFilenames?: string[]
  pollStatus?: "AVAILABLE" | "QUARANTINED"
} = {}) {
  return vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    if (method === "POST" && (url as string).endsWith("/files")) {
      const body = init.body ? (JSON.parse(init.body as string) as { filename?: string }) : {}
      const filename = body.filename ?? "a.pdf"
      if (initiateStatus !== 200 || initiateFailFilenames.includes(filename)) {
        const status = initiateStatus !== 200 ? initiateStatus : 500
        return Promise.resolve(
          jsonResponse({ error: { code: "UNKNOWN", message: "rejected", statusCode: status } }, status),
        )
      }
      const fileId = `f-${filename.replace(/\.[a-z0-9]+$/i, "")}`
      return Promise.resolve(jsonResponse({ fileId, deduplicated: true }))
    }
    if (method === "GET" && (url as string).includes("/files/f-")) {
      return Promise.resolve(
        jsonResponse({
          id: "f-x",
          ownerId: null,
          filename: "a.pdf",
          mimeType: "application/pdf",
          size: 5,
          checksumSha256: null,
          status: pollStatus,
          metadata: {},
          createdAt: "t",
          updatedAt: "t",
        }),
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
// config, per the pattern already used by use-record-mutations.test.tsx.
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

describe("useFileUploads", () => {
  beforeEach(() => useUploadStore.getState().reset())

  it("invalidates the files list once the upload reaches indexed", async () => {
    const fetchImpl = makeFetchImpl()
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        // A second, unrelated domain mounted alongside `/files` — this is what
        // lets the test tell "the files list refetched" apart from "something
        // triggered a refetch of everything".
        useSWR(keys.list("/files", q))
        useSWR(keys.list("/contacts", q))
        return useFileUploads()
      },
      { wrapper: wrapper(fetchImpl) },
    )

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(1))
    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/contacts?").length).toBe(1))
    fetchImpl.mockClear()

    await act(async () => {
      await result.current.start([fakeFile()])
    })

    // This is the assertion a missing `invalidate(scopes.allLists("/files"))`
    // call would fail: without it the list GET count never rises above 0.
    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(1))
    // And the assertion a too-broad invalidation (e.g. invalidating
    // everything) would fail: the untouched `/contacts` list must not refetch.
    expect(getCalls(fetchImpl, "GET", "/contacts?").length).toBe(0)
  })

  it("does not invalidate the files list when the upload fails", async () => {
    const fetchImpl = makeFetchImpl({ initiateStatus: 500 })
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/files", q))
        return useFileUploads()
      },
      { wrapper: wrapper(fetchImpl) },
    )

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(1))
    fetchImpl.mockClear()

    await act(async () => {
      await result.current.start([fakeFile()])
    })

    expect(result.current.items[0]).toMatchObject({ phase: "failed" })

    // Give a stray invalidation a full macrotask to land before asserting it
    // never came — asserting synchronously right after `act` would pass for
    // the wrong reason if the call were merely delayed rather than absent.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(0)
  })

  it("invalidates the files list when only some uploads in a batch succeed", async () => {
    // This batch does not isolate `anyFileIdSeen` from a result-based check —
    // the guard has no `results` term at all any more, so the question is
    // moot. What it does prove is that a partial batch (one success among
    // failures) still invalidates.
    const fetchImpl = makeFetchImpl({ initiateFailFilenames: ["bad1.pdf", "bad2.pdf"] })
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/files", q))
        return useFileUploads()
      },
      { wrapper: wrapper(fetchImpl) },
    )

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(1))
    fetchImpl.mockClear()

    await act(async () => {
      await result.current.start([
        fakeFile("good.pdf"),
        fakeFile("bad1.pdf"),
        fakeFile("bad2.pdf"),
      ])
    })

    const phases = result.current.items.map((i) => i.phase).sort()
    expect(phases).toEqual(["failed", "failed", "indexed"])
    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(1))
  })

  it("invalidates the files list when initiate succeeds but the pipeline fails afterwards", async () => {
    // Initiate succeeds and hands back a fileId — the server has already
    // created a PENDING row the default list query would show — but the poll
    // then discovers the file was quarantined. `uploadFile` reports this the
    // same way as any other post-initiate failure: it resolves `null`, and
    // its *final* progress frame carries no fileId either. Only an earlier
    // frame (the "processing" one, emitted before polling) proves initiate
    // got through, which is exactly what the `anyFileIdSeen` tracking in the
    // hook is for — a guard using only `results.some(r => r !== null)` would
    // (wrongly) skip invalidation here.
    const fetchImpl = makeFetchImpl({ pollStatus: "QUARANTINED" })
    const q = initialQuery()

    const { result } = renderHook(
      () => {
        useSWR(keys.list("/files", q))
        return useFileUploads()
      },
      { wrapper: wrapper(fetchImpl) },
    )

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(1))
    fetchImpl.mockClear()

    await act(async () => {
      await result.current.start([fakeFile()])
    })

    expect(result.current.items[0]).toMatchObject({ phase: "failed", fileId: "f-a" })
    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/files?").length).toBe(1))
  })
})
