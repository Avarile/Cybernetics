import { ApiError, parseErrorEnvelope } from "@/lib/api/errors"
import { SseParser } from "./sse"
import type { ChatStreamRequest, SseEvent } from "./types"

export interface StreamOptions {
  baseUrl: string
  /** Read at call time, not captured: a refresh may have rotated it. */
  getAccessToken: () => string | null
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
 * parse JSON, which would defeat streaming entirely. The cost is that the
 * single-flight refresh does not apply here — see the 401 note below.
 */
export async function streamChat(opts: StreamOptions): Promise<StreamResult> {
  const { baseUrl, getAccessToken, body, signal, onEvent } = opts

  const headers = new Headers({
    "content-type": "application/json",
    accept: "text/event-stream",
  })
  const token = getAccessToken()
  if (token) headers.set("authorization", `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(`${baseUrl}/agent/chat/stream`, {
      method: "POST",
      credentials: "omit",
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (isAbort(err, signal)) return { truncated: false, aborted: true }
    throw new ApiError({
      code: "NETWORK",
      message: err instanceof Error ? err.message : "Could not reach the agent",
      statusCode: 0,
    })
  }

  // A failure before the stream opens is a normal JSON error envelope, not an
  // SSE frame — surface it as one rather than as a message in the transcript.
  //
  // A 401 here is not retried. The refresh latch lives in ApiClient, and racing
  // a second refresh from this path is exactly what revokes the token family.
  // The caller should have made an ordinary request first (the conversation
  // list does), so an expired token is refreshed before a turn is ever started.
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      /* leave as text; parseErrorEnvelope falls back */
    }
    throw parseErrorEnvelope(res.status, parsed)
  }

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
