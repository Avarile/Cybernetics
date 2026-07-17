'use client'

import { useEffect, useRef } from 'react'
import { useAuthStore, wireAuthUnauthorizedHandler } from '@/lib/state-management/auth.store'

/** Wires the unauthorized handler and bootstraps the session once per load. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const started = useRef(false)
  const bootstrap = useAuthStore((s) => s.bootstrap)

  useEffect(() => {
    if (started.current) return
    started.current = true
    wireAuthUnauthorizedHandler()
    void bootstrap()
  }, [bootstrap])

  return <>{children}</>
}
