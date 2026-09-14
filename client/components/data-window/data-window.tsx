"use client"

import { useEffect, useRef } from "react"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { SidebarProvider } from "@/components/ui/sidebar"
import { useSession } from "@/features/session/use-session"
import { useWindowControls } from "@/features/workspace/use-window-controls"
import { DomainNav, DomainSelect } from "./domain-nav"
import { resolveLocation, visibleDomains, visibleSections } from "./registry"
import { ScopePicker } from "./scope-picker"
import { SectionHost } from "./section-host"
import { SectionTabs } from "./section-tabs"
import type { DomainKey } from "./types"

export interface DataWindowProps {
  domain?: string
  section?: string
  /**
   * Namespaced BY DOMAIN — `{ projects: { projectId: "…" } }`.
   *
   * A bare `{ projectId }` would leak one domain's choice into the next scoped
   * section that happened to use the same param name.
   */
  scope?: Record<string, Record<string, string>>
  __windowId?: string
}

/**
 * Every data domain, in one window.
 *
 * Layout is the vendored `settings-dialog.tsx` demo's — a SidebarProvider with
 * `items-start`, a `collapsible="none"` rail, and a breadcrumb header over the
 * pane. Three things from the demo are deliberately absent:
 *
 * - The `Dialog` wrapper. `WindowFrame` already renders role="dialog" with a
 *   title bar, close button and Escape handling; nesting a Radix Dialog inside
 *   it is a box in a box with two focus traps. Same reasoning as the auth
 *   gate's `chrome: "none"`.
 * - The fixed `h-[480px]` / `md:max-h-[500px]` sizing. This window is
 *   resizable, so the shell is `h-full min-h-0` throughout.
 * - Its own open state and DialogTrigger — the workspace store owns those.
 */
export function DataWindow({ domain, section, scope, __windowId }: DataWindowProps) {
  const { principal } = useSession()
  const role = principal?.role
  const { patchProps } = useWindowControls(__windowId ?? "")

  const domains = visibleDomains(role)
  const at = resolveLocation(domain, section, role)

  // Write a fallback back into props, so the next render (and the next reload)
  // does not have to re-resolve it. An effect, not a render-phase call: this
  // writes to a store other components subscribe to, which is a side effect
  // React is free to double-invoke or discard during render.
  const resolvedDomain = at?.domain.key
  const resolvedSection = at?.section.key
  useEffect(() => {
    if (!__windowId || !resolvedDomain || !resolvedSection) return
    if (resolvedDomain === domain && resolvedSection === section) return
    patchProps({ domain: resolvedDomain, section: resolvedSection })
    // `patchProps` is rebuilt each render (it closes over the id); depending on
    // it would re-run this every commit. The id is the part that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [__windowId, resolvedDomain, resolvedSection, domain, section])

  // Move focus to the pane when the section changes, so a screen-reader user
  // is not left in the tab row while the content underneath it swaps.
  const pane = useRef<HTMLElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    pane.current?.focus()
  }, [resolvedDomain, resolvedSection])

  if (!at) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyTitle>Nothing here</EmptyTitle>
          <EmptyDescription>
            This account has access to no data domains.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const sections = visibleSections(at.domain, role)
  const sectionScope = at.section.body.kind === "scoped-table" ? at.section.body.scope : null
  const scopeId = sectionScope ? scope?.[at.domain.key]?.[sectionScope.param] : undefined

  // One patch, not two: patching the domain alone would leave a section key
  // belonging to the previous domain, which resolveLocation would then
  // silently correct on the next render — a fallback masking a bug.
  function selectDomain(key: DomainKey) {
    const next = domains.find((d) => d.key === key)
    if (!next) return
    patchProps({ domain: key, section: visibleSections(next, role)[0]?.key ?? "" })
  }

  return (
    <SidebarProvider className="h-full min-h-0 items-start">
      <DomainNav domains={domains} active={at.domain.key} onSelect={selectDomain} />

      <main
        ref={pane}
        tabIndex={-1}
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden outline-none"
      >
        <header className="flex shrink-0 items-center gap-3 px-4 py-3">
          <DomainSelect domains={domains} active={at.domain.key} onSelect={selectDomain} />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">Data</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem className="hidden md:block">{at.domain.label}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{at.section.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>

          {sectionScope && (
            <div className="ml-auto">
              <ScopePicker
                scope={sectionScope}
                value={scopeId}
                onChange={(id) =>
                  patchProps({
                    // Namespaced by domain, so Projects' choice cannot leak
                    // into another domain's scoped section.
                    scope: { ...scope, [at.domain.key]: { [sectionScope.param]: id } },
                  })
                }
              />
            </div>
          )}
        </header>

        <SectionTabs
          sections={sections}
          active={at.section.key}
          onSelect={(key) => patchProps({ section: key })}
        />

        {at.section.hint && (
          <p className="shrink-0 px-4 pt-2 text-xs text-muted-foreground">{at.section.hint}</p>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {/*
            The mount key is what makes a section switch a fresh start: page,
            search, filters, selection and hidden columns all belong to one
            resource and must not survive into another.
          */}
          <SectionHost
            key={`${at.domain.key}:${at.section.key}:${scopeId ?? ""}`}
            section={at.section}
            scopeId={scopeId}
          />
        </div>
      </main>
    </SidebarProvider>
  )
}
