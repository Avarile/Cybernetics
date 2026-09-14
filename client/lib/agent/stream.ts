import { ApiError, parseErrorEnvelope } from "@/lib/api/errors"
import { SseParser } from "./sse"
import type { ChatStreamRequest, SseEvent } from "./types"

export interface StreamOptions {
  baseUrl: string
  /** Read at call time, not captured: a refresh may have rotated it. */
  getAccessToken: () => string | null
  /**
   * `ApiClient.refresh` — the shared single-flight latch, not a refresh of this
   * module's own. Optional so a test (or a caller with no session) can leave the
   * retry out; omitting it restores the old "report the 401" behaviour.
   */
  refresh?: () => Promise<boolean>
  body: ChatStreamRequest
  signal?: AbortSignal
  onEvent: (event: SseEvent) => void
}

export interface StreamResult {
  /** True when the stream ended with a partial frame still buffered — i.e. the
   *  connection was cut mid-event rather than closed cleanly. */
  truncated: boolean
  /** True when the caller aborted. */
  aborted: boolean
}

/**
 * Streams one agent turn.
 *
 * `POST /agent/chat/stream` is SSE over POST, so `EventSource` — which only
 * issues GET and cannot send a body or an Authorization header — is unusable.
 * This is `fetch` plus a manual reader instead.
 *
 * Deliberately outside the ApiClient: that wrapper buffers the whole body to
 * parse JSON, which would defeat streaming entirely. It still borrows that
 * client's refresh latch rather than owning one — see the 401 note below.
 */
export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const { baseUrl, getAccessToken, refresh, body, signal, onEvent } = opts

  /** One attempt at opening the stream. `null` means the caller aborted. */
  async function open(): Promise<Response | null> {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "text/event-stream",
    })
    // Read the token per attempt rather than once above: the retry below exists
    // precisely because a refresh rotated it between the two.
    const token = getAccessToken()
    if (token) headers.set("authorization", `Bearer ${token}`)

    try {
      return await fetch(`${baseUrl}/agent/chat/stream`, {
        method: "POST",
        credentials: "omit",
        headers,
        body: JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (isAbort(err, signal)) return null
      throw new ApiError({
        code: "NETWORK",
        message: err instanceof Error ? err.message : "Could not reach the agent",
        statusCode: 0,
      })
    }
  }

  let res = await open()
  if (!res) return { truncated: false, aborted: true }

  // A 401 before the stream opens is worth exactly one retry: the access token
  // went stale while the terminal sat idle, and no turn has started yet, so a
  // replay costs nothing and is not visible in the transcript.
  //
  // `refresh` is ApiClient's single-flight latch. This path must NOT post to
  // /auth/refresh itself — auth.service.ts rotates with a compare-and-set and
  // reads a second concurrent use of one refresh token as theft, revoking the
  // whole family. Borrowing the latch means a stream racing an ordinary request
  // waits on the same promise instead of starting a rival rotation.
  //
  // This used to rely on the caller having made an ordinary request first (the
  // conversation list does), which held right up until the first thing a user
  // did after idling was start a turn.
  if (res.status === 401 && refresh) {
    const err = parseErrorEnvelope(401, await readEnvelope(res))
    if (!err.isAuthExpiry() || !(await refresh())) throw err
    res = await open()
    if (!res) return { truncated: false, aborted: true }
  }

  // A failure before the stream opens is a normal JSON error envelope, not an
  // SSE frame — surface it as one rather than as a message in the transcript.
  if (!res.ok) throw parseErrorEnvelope(res.status, await readEnvelope(res))

  if (!res.body) {
    throw new ApiError({
      code: "NETWORK",
      message: "The agent returned no stream",
      statusCode: res.status,
    })
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = new SseParser()
  let aborted = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      // `stream: true` keeps a multi-byte character split across chunks intact.
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        onEvent(event)
      }
    }
    // Flush the decoder, then any frame that never got its blank line.
    const tail = decoder.decode()
    if (tail) for (const event of parser.push(tail)) onEvent(event)
    const truncated = parser.hasPartial
    for (const event of parser.flush()) onEvent(event)
    return { truncated, aborted: false }
  } catch (err) {
    if (isAbort(err, signal)) {
      aborted = true
      return { truncated: false, aborted: true }
    }
    throw err
  } finally {
    // Releases the connection. Cancelling an already-finished reader is a
    // no-op; cancelling an aborted one is what actually frees the socket.
    if (!aborted) {
      reader.cancel().catch(() => undefined)
    }
  }
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return err instanceof Error && err.name === "AbortError"
}

/**
 * Reads a non-streaming error body. A proxy can answer with HTML instead of the
 * envelope, so the text is handed back as-is on a parse failure and
 * `parseErrorEnvelope` falls through to its UNKNOWN branch.
 */
async function readEnvelope(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "")
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
