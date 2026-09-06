"use client"

import { useCallback, type ReactNode } from "react"
import { StateProvider } from "@/lib/swr/provider"
import { resetClientState } from "@/lib/state/reset"

/**
 * Wires resetClientState into StateProvider's onAuthFailure.
 *
 * layout.tsx is a server component and can't hold a callback itself, so this
 * client component is the seam: StateProvider stays ignorant of which stores
 * exist, and resetClientState stays ignorant of SWR.
 */
export function Providers({ children }: { children: ReactNode }) {
  const onAuthFailure = useCallback(
    (mutate: Parameters<typeof resetClientState>[0]) => resetClientState(mutate),
    [],
  )
  return <StateProvider onAuthFailure={onAuthFailure}>{children}</StateProvider>
}
