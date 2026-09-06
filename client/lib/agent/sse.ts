import type { SseEvent } from "./types"

/**
 * Incremental SSE frame parser.
 *
 * The backend writes `data: {json}\n\n` per event (`sseFrame` in
 * chunk-to-sse.ts). A `text-delta` frame is routinely split across two network
 * chunks, so parsing per-chunk instead of per-blank-line corrupts the stream —
 * this is the single most likely place for the transport to go subtly wrong.
 *
 * Stateful by design: feed it decoded strings in arrival order and it yields
 * whole events, keeping any partial tail for the next call.
 */
export class SseParser {
  private buffer = ""

  /** Frames completed by this chunk. May be empty. */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk
    const events: SseEvent[] = []

    // Accept \n\n and \r\n\r\n: a proxy may rewrite line endings even though
    // our own writer only ever emits \n.
    let match: RegExpExecArray | null
    const separator = /\r?\n\r?\n/

    for (;;) {
      match = separator.exec(this.buffer)
      if (!match) break
      const raw = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      const event = parseFrame(raw)
      if (event) events.push(event)
    }

    return events
  }

  /**
   * Anything left after the stream closed. A well-behaved stream ends on a
   * separator and this returns nothing; a truncated one may still hold a
   * complete frame that never got its blank line.
   */
  flush(): SseEvent[] {
    const rest = this.buffer.trim()
    this.buffer = ""
    if (!rest) return []
    const event = parseFrame(rest)
    return event ? [event] : []
  }

  /** True when a partial frame is still buffered — i.e. the stream was cut
   *  mid-event. */
  get hasPartial(): boolean {
    return this.buffer.trim().length > 0
  }
}

/**
 * One frame's text → an event.
 *
 * Returns null for anything unrecognised rather than throwing: comment lines
 * (`:heartbeat`), blank frames, and future event types a newer backend might
 * add must not take the stream down.
 */
export function parseFrame(raw: string): SseEvent | null {
  const dataLines: string[] = []

  for (const line of raw.split(/\r?\n/)) {
    // Per the SSE grammar a leading colon is a comment; proxies send these as
    // keep-alives.
    if (line.startsWith(":")) continue
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) return null

  // Multi-line `data:` fields concatenate with newlines, per the SSE spec.
  const payload = dataLines.join("\n")
  if (!payload) return null

  try {
    const parsed: unknown = JSON.parse(payload)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === "string"
    ) {
      return parsed as SseEvent
    }
    return null
  } catch {
    return null
  }
}
