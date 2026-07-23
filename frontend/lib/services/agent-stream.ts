import { clientEnv } from '@/lib/config/env'
import { ERROR_CODES } from '@/lib/config/constants'
import { getAccessToken } from '@/lib/http/token-store'
import { refreshSession } from '@/lib/auth/session'
import type { ChatStreamBody, SseEvent } from '@/lib/interfaces/chat.interface'

const ENDPOINT = `${clientEnv.apiUrl}/agent/chat/stream`

interface StreamOpts {
  onEvent: (event: SseEvent) => void
  signal?: AbortSignal
}

async function postStream(body: ChatStreamBody, signal?: AbortSignal): Promise<Response> {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })
}

/** POST the chat stream and invoke onEvent per SSE event. Injects the bearer and
 *  refreshes once on an AUTH_TOKEN_EXPIRED response (mirrors the api-client interceptor). */
export async function streamAgentChat(body: ChatStreamBody, opts: StreamOpts): Promise<void> {
  let res = await postStream(body, opts.signal)

  if (!res.ok) {
    const envelope = await res.json().catch(() => null)
    const code = envelope?.error?.code
    if (code === ERROR_CODES.AUTH_TOKEN_EXPIRED) {
      await refreshSession()
      res = await postStream(body, opts.signal)
    }
    if (!res.ok) {
      const msg = envelope?.error?.message ?? `Stream failed (${res.status})`
      throw new Error(msg)
    }
  }

  if (!res.body) return
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const line = frame.trim()
      if (!line.startsWith('data:')) continue
      const json = line.slice(line.indexOf(':') + 1).trim()
      if (!json || json === '[DONE]') continue
      try {
        opts.onEvent(JSON.parse(json) as SseEvent)
      } catch {
        // ignore malformed frame
      }
    }
  }
}
