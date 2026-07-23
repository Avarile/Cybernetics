'use client'
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useChatStore } from '@/lib/state-management/chat.store'

/** Two-way projection between the URL's `?c=` param and the active conversation id. */
export function useChatUrlSync() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const activeId = useChatStore((s) => s.activeConversationId)
  const setActive = useChatStore((s) => s.setActiveConversation)
  const hydrated = React.useRef(false)
  const justHydrated = React.useRef(false)

  React.useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    const c = params.get('c')
    if (c) setActive(c)
    justHydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (!hydrated.current) return
    if (justHydrated.current) {
      justHydrated.current = false
      return
    }
    const next = new URLSearchParams()
    if (activeId) next.set('c', activeId)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [activeId, pathname, router])
}
