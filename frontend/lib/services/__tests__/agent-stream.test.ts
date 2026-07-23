import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const refreshSession = vi.fn()
vi.mock('@/lib/auth/session', () => ({ refreshSession: (...a: unknown[]) => refreshSession(...a) }))
vi.mock('@/lib/http/token-store', () => ({ getAccessToken: vi.fn() }))

import { streamAgentChat } from '@/lib/services/agent-stream'
import { getAccessToken } from '@/lib/http/token-store'
import type { SseEvent } from '@/lib/interfaces/chat.interface'

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) { for (const f of frames) c.enqueue(enc.encode(f)); c.close() },
  })
}
const FRAMES = [
  'data: {"type":"start","conversationId":"c1","runId":"r1"}\n\n',
  'data: {"type":"text-delta","delta":"Hi "}\n\ndata: {"type":"text-delta","delta":"there"}\n\n',
  'data: {"type":"done","status":"succeeded"}\n\n',
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessToken).mockReturnValue('tok-1')
})
afterEach(() => vi.unstubAllGlobals())

describe('streamAgentChat', () => {
  it('parses SSE frames (including two in one chunk) into events', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, body: sseBody(FRAMES) }))
    const events: SseEvent[] = []
    await streamAgentChat({ message: 'hello' }, { onEvent: (e) => events.push(e) })
    expect(events.map((e) => e.type)).toEqual(['start', 'text-delta', 'text-delta', 'done'])
    expect(events[1]).toMatchObject({ type: 'text-delta', delta: 'Hi ' })
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3000/agent/chat/stream')
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    expect(JSON.parse(init.body)).toEqual({ message: 'hello' })
  })

  it('refreshes once and retries on an AUTH_TOKEN_EXPIRED response', async () => {
    vi.mocked(getAccessToken).mockReturnValueOnce('tok-1').mockReturnValue('tok-2')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, body: sseBody(['data: {"type":"done","status":"succeeded"}\n\n']) })
    vi.stubGlobal('fetch', fetchMock)
    refreshSession.mockResolvedValue({ accessToken: 'tok-2' })
    const events: SseEvent[] = []
    await streamAgentChat({ message: 'x' }, { onEvent: (e) => events.push(e) })
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(events.map((e) => e.type)).toEqual(['done'])
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok-2')
  })

  it('throws with the envelope message on a non-refreshable error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: () => Promise.resolve({ error: { code: 'FORBIDDEN', message: 'nope' } }) }))
    await expect(streamAgentChat({ message: 'x' }, { onEvent: () => {} })).rejects.toThrow('nope')
  })

  it('throws with the retry response message when refresh succeeds but the retry still fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: { code: 'AUTH_TOKEN_EXPIRED', message: 'expired' } }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({ error: { code: 'FORBIDDEN', message: 'nope after retry' } }) })
    vi.stubGlobal('fetch', fetchMock)
    refreshSession.mockResolvedValue({ accessToken: 'tok-2' })
    await expect(streamAgentChat({ message: 'x' }, { onEvent: () => {} })).rejects.toThrow('nope after retry')
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
