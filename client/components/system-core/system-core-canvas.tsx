"use client"

import dynamic from "next/dynamic"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useWindowStore } from "@/stores/window.store"
import Boundary from "./Boundary"
import Panel from "./Panel"
import useLive from "./hooks/useLive"
import useModules from "./hooks/useModules"
import { useLocalize } from "./shims/localize"

/**
 * Our shell around the reference's scene.
 *
 * This file is ours, not the reference's — upstream mounts the same pieces
 * inside a full-screen Recoil-driven modal (`Dialog.tsx`), whereas here the
 * core IS the authenticated surface with feature windows over it. Everything it
 * mounts is the reference's own code, wired through the reference's own hooks,
 * so the scene renders identically.
 *
 * `three` is reachable only from Scene down, and `ssr: false` is mandatory —
 * there is no WebGL context on the server.
 */
const Scene = dynamic(() => import("./Scene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center" role="status">
      <Spinner className="size-5 text-white/40" />
      <span className="sr-only">Loading</span>
    </div>
  ),
})

function SceneError({ retry }: { retry: () => void }) {
  const localize = useLocalize()
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8">
      <p className="text-center text-sm text-white/50">
        {localize("com_ui_system_core_unavailable")}
      </p>
      <Button variant="outline" size="sm" onClick={retry}>
        {localize("com_ui_system_core_live_retry")}
      </Button>
    </div>
  )
}

export interface SystemCoreCanvasProps {
  scannerVisible: boolean
  panelOpen: boolean
  resetToken: number
  /** False while signed out: the poll is owner-scoped and the stack is inert. */
  active: boolean
}

export function SystemCoreCanvas({
  scannerVisible,
  panelOpen,
  resetToken,
  active,
}: SystemCoreCanvasProps) {
  const live = useLive(active)
  const modules = useModules({
    catalog: live.catalog,
    catalogRevision: live.catalogRevision,
  })
  const openWindow = useWindowStore((s) => s.openWindow)

  // The list toggles selection on re-click; picking from the list should always
  // land on the module clicked.
  const selectFromList = useCallback((id: string) => modules.select(id), [modules])

  return (
    <div className="flex h-full w-full">
      <div className="relative min-h-0 min-w-0 flex-1">
        <Boundary fallback={<SceneError retry={live.retry} />}>
          <Scene
            modules={modules.modules}
            readings={live.readings}
            runtimeFor={modules.runtimeFor}
            parkPhase={modules.parkPhase}
            selected={modules.selected}
            onSelect={modules.select}
            scannerVisible={scannerVisible}
            resetToken={resetToken}
          />
        </Boundary>
      </div>

      {panelOpen && (
        <div className="hidden w-[320px] shrink-0 md:block">
          <Panel
            modules={modules.modules}
            readings={live.readings}
            selected={modules.selected}
            onSelect={selectFromList}
            onAdd={modules.add}
            onRemove={modules.remove}
            onReplace={modules.replace}
            onReset={modules.reset}
            livePhase={modules.livePhase}
            liveState={live.state}
            cacheAgeMs={live.cacheAgeMs}
            onRetry={live.retry}
          />
        </div>
      )}
    </div>
  )
}
