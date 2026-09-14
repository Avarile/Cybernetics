import type { ApiClient } from "@/lib/api/client"

/**
 * Turns a tuple cache key into a request.
 *
 * The switch is exhaustive and throws on anything it does not recognise. A
 * fetcher that quietly resolves `undefined` for a mistyped key produces an
 * empty list that looks exactly like a legitimately empty domain — the same
 * failure mode `buildListUrl`'s tests exist to prevent.
 */
export function createFetcher(client: ApiClient) {
  return async (key: readonly unknown[]): Promise<unknown> => {
    switch (key[0]) {
      case "session":
        return client.get("/auth/me")
      case "conversations":
        return client.get(key[1] as string)
      case "conversation":
        return client.get(`/agent/conversations/${key[1] as string}/messages`)
      case "list":
        return client.get(key[2] as string)
      case "record":
        return client.get(`${key[1] as string}/${key[2] as string}`)
      case "collection":
        return client.get(key[1] as string)
      case "lookup":
        // One fixed page, at the cap every list DTO declares. Past 100 rows a
        // lookup cannot resolve every id and says so (`truncated`) rather than
        // labelling the first page and leaving the rest as raw uuids. A bare
        // array endpoint ignores the unknown query param.
        return client.get(`${key[1] as string}?limit=100`)
      case "report":
        return client.get(key[1] as string)
      default:
        throw new Error(`Unknown SWR key: ${JSON.stringify(key)}`)
    }
  }
}
