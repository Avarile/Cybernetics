import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatStore } from '@/lib/state-management/chat.store'

const replace = vi.fn()
const searchParams = vi.fn(() => new URLSearchParams())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard/chat',
  useSearchParams: () => searchParams(),
}))
import { useChatUrlSync } from '@/lib/hooks/use-chat-url-sync'

beforeEach(() => {
  replace.mockClear()
  searchParams.mockReturnValue(new URLSearchParams())
  useChatStore.setState({ activeConversationId: null, historyRailOpen: true })
})

describe('useChatUrlSync', () => {
  it('hydrates the active conversation id from the ?c= param on mount without stripping it', () => {
    searchParams.mockReturnValue(new URLSearchParams('c=c1'))
    renderHook(() => useChatUrlSync())
    expect(useChatStore.getState().activeConversationId).toBe('c1')
    // Skip-once regression guard: the hydration commit's write-back effect
    // still runs with a stale (pre-hydration) store closure in that same
    // commit — if the skip-once flag didn't suppress it, it would call
    // router.replace(pathname) with an empty querystring and strip ?c=c1
    // before the hydrated state (from setActive) propagates on the next
    // render. Any replace call that does fire once the store settles must
    // keep reflecting the hydrated id, never a stripped one.
    for (const [url] of replace.mock.calls) {
      expect(url).toContain('c=c1')
    }
  })

  it('writes the active conversation id back to the URL when the store changes', () => {
    const { rerender } = renderHook(() => useChatUrlSync())
    expect(replace).not.toHaveBeenCalled()

    act(() => { useChatStore.setState({ activeConversationId: 'c2' }) })
    rerender()

    expect(replace).toHaveBeenCalled()
    const [url, opts] = replace.mock.calls[replace.mock.calls.length - 1]
    expect(url).toContain('?c=c2')
    expect(opts).toEqual({ scroll: false })
  })
})
