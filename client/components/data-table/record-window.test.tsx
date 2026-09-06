import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SWRConfig } from "swr"
import { describe, expect, it, vi } from "vitest"
import { StateProvider } from "@/lib/swr/provider"
import { useRecordMutations } from "@/features/records/use-record-mutations"
import { RecordWindow } from "./record-window"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const RECORD = {
  id: "1",
  firstName: "Ada",
  lastName: "Lovelace",
  displayName: "",
  primaryEmail: "",
  primaryPhone: "",
  jobTitle: "",
  status: "active",
  visibility: "private",
  notes: "",
}

/**
 * GET /contacts/1 answers with genuinely different content on each call — SWR
 * deep-compares fetched data against the cache (`dequal`) and keeps the OLD
 * object when a response is byte-identical to the last one, so a mock that
 * always returned the same content could never distinguish "re-seeded from a
 * fresh object" from "nothing changed at all". A drifting field (unrelated to
 * anything this window edits) is also the realistic case: real records change
 * between reads for reasons that have nothing to do with the open form.
 */
function makeFetchImpl() {
  let getCount = 0
  return vi.fn((url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET"
    if (method === "GET" && (url as string).endsWith("/contacts/1")) {
      getCount += 1
      return Promise.resolve(jsonResponse({ ...RECORD, jobTitle: `Role v${getCount}` }))
    }
    if (method === "DELETE") {
      return Promise.resolve(jsonResponse(null, 204))
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

/** Stands in for "another open window", whose delete invalidates the whole
 *  `["record", "/contacts"]` prefix — including the record this test's
 *  RecordWindow has open — exactly as a real sibling Contacts window would. */
function SiblingDelete() {
  const { remove } = useRecordMutations("/contacts")
  return (
    <button onClick={() => void remove(["999"])}>trigger sibling delete</button>
  )
}

function tree(fetchImpl: ReturnType<typeof makeFetchImpl>, mode: "edit" | "detail" = "edit") {
  return (
    <SWRConfig value={{ provider: () => new Map() }}>
      <StateProvider baseUrl="https://api.test" fetchImpl={fetchImpl as unknown as typeof fetch}>
        <RecordWindow domain="contacts" endpoint="/contacts" mode={mode} id="1" />
        <SiblingDelete />
      </StateProvider>
    </SWRConfig>
  )
}

describe("RecordWindow", () => {
  it("keeps an in-progress edit when another window's mutation revalidates the same record", async () => {
    const fetchImpl = makeFetchImpl()
    const user = userEvent.setup()
    render(tree(fetchImpl))

    // Seeded from the loaded record.
    await waitFor(() => expect(screen.getByLabelText("First name")).toHaveValue("Ada"))

    // The user starts editing, but hasn't saved yet.
    const notes = screen.getByLabelText("Notes")
    await user.clear(notes)
    await user.type(notes, "unsaved draft")
    expect(notes).toHaveValue("unsaved draft")

    // A sibling window deletes an unrelated row, invalidating the whole
    // `/contacts` record scope — which includes record "1", open here.
    await user.click(screen.getByRole("button", { name: "trigger sibling delete" }))

    // Prove the revalidation actually happened (not that nothing fired): the
    // record refetches at least once more beyond the initial load.
    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/contacts/1").length).toBeGreaterThanOrEqual(2))

    // The unsaved draft must survive the background refetch. A version keyed
    // on `record`'s object identity would have re-seeded here and reverted
    // this back to "" (RECORD.notes) the moment the new object landed.
    expect(notes).toHaveValue("unsaved draft")
  })

  it("keeps a detail window's read-only view in sync with a sibling window's revalidation", async () => {
    const fetchImpl = makeFetchImpl()
    const user = userEvent.setup()
    render(tree(fetchImpl, "detail"))

    // Seeded from the loaded record — "Role v1" is this mock's first response.
    await waitFor(() => expect(screen.getByLabelText("Job title")).toHaveValue("Role v1"))

    // A sibling window deletes an unrelated row, invalidating the whole
    // `/contacts` record scope — which includes record "1", open here — the
    // same trigger the edit-mode test above uses.
    await user.click(screen.getByRole("button", { name: "trigger sibling delete" }))

    await waitFor(() => expect(getCalls(fetchImpl, "GET", "/contacts/1").length).toBeGreaterThanOrEqual(2))

    // Detail is read-only — there is nothing typed to protect — so it must
    // show the freshly revalidated value rather than freezing on the snapshot
    // from first paint. A guard that seeds detail the same way edit/create
    // does (once, never again) would still read "Role v1" here.
    await waitFor(() => expect(screen.getByLabelText("Job title")).toHaveValue("Role v2"))
  })
})
