import { describe, expect, it, vi } from "vitest"
import type { ApiClient } from "@/lib/api/client"
import { createFetcher } from "./fetcher"
import { keys } from "./keys"
import { initialQuery } from "@/components/data-table/query"

function stubClient() {
  const get = vi.fn().mockResolvedValue({ ok: true })
  return { client: { get } as unknown as ApiClient, get }
}

describe("createFetcher", () => {
  it("resolves the session key to /auth/me", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.session())
    expect(get).toHaveBeenCalledWith("/auth/me")
  })

  it("resolves the conversations key to its embedded url", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.conversations(2, 10))
    expect(get).toHaveBeenCalledWith("/agent/conversations?page=2&limit=10")
  })

  it("resolves a messages key to the conversation's messages route", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.messages("c9"))
    expect(get).toHaveBeenCalledWith("/agent/conversations/c9/messages")
  })

  it("resolves a list key to the url the key already carries", async () => {
    const { client, get } = stubClient()
    const key = keys.list("/contacts", initialQuery())
    await createFetcher(client)(key)
    expect(get).toHaveBeenCalledWith(key[2])
  })

  it("resolves a record key to endpoint/id", async () => {
    const { client, get } = stubClient()
    await createFetcher(client)(keys.record("/contacts", "abc"))
    expect(get).toHaveBeenCalledWith("/contacts/abc")
  })

  it("rejects an unknown key rather than silently returning undefined", async () => {
    const { client } = stubClient()
    await expect(createFetcher(client)(["nope"] as never)).rejects.toThrow(/unknown swr key/i)
  })
})
