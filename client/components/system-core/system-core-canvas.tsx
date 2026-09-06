"use client"

import dynamic from "next/dynamic"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useDomainStore } from "@/stores/domain.store"
import { useWindowStore } from "@/stores/window.store"
import Boundary from "./Boundary"
import { DOMAIN_BY_KEY, DOMAINS } from "./data/domains"
import { useDomainHealth } from "./use-domain-health"

/**
 * `three` is reachable only from Scene down, and `ssr: false` is mandatory —
 * there is no WebGL context on the server. Together these keep the ~600 KB
 * library out of the initial bundle and off the server render.
 */
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center" role="status">
      <Spinner className="size-5 text-white/40" />
      <span className="sr-only">Loading the system core</span>
    </div>
  ),
})

function SceneError({ retry }: { retry: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8">
      <p className="text-center text-sm text-white/50">
        The system core could not be rendered.
      </p>
      <Button variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}

export interface SystemCoreCanvasProps {
  scannerVisible: boolean
  soundEnabled: boolean
  resetToken: number
}

export function SystemCoreCanvas({
  scannerVisible,
  soundEnabled,
  resetToken,
}: SystemCoreCanvasProps) {
  useDomainHealth()

  const [selected, setSelected] = useState<string | null>(null)
  const openWindow = useWindowStore((s) => s.openWindow)

  // Subscribing to the whole map rather than per-strip: eight entries, and it
  // changes once per poll, so a coarse subscription is cheaper than eight fine
  // ones. Read through a stable callback so Scene's memo key does not churn.
  const byKey = useDomainStore((s) => s.byKey)
  const healthFor = useCallback(
    (key: string) => byKey[key]?.health ?? "unknown",
    [byKey],
  )

  const handleSelect = useCallback(
    (key: string | null) => {
      setSelected(key)
      if (!key) return
      const domain = DOMAIN_BY_KEY.get(key)
      if (domain) {
        openWindow({ kind: domain.window, title: domain.label })
      }
    },
    [openWindow],
  )

  return (
    <Boundary fallback={(retry) => <SceneError retry={retry} />}>
      <Scene
        domains={DOMAINS}
        healthFor={healthFor}
        selected={selected}
        onSelect={handleSelect}
        scannerVisible={scannerVisible}
        soundEnabled={soundEnabled}
        resetToken={resetToken}
      />
    </Boundary>
  )
}
