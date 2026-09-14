"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { DomainKey, DomainSpec } from "./types"

export interface DomainNavProps {
  domains: DomainSpec[]
  active: DomainKey
  onSelect: (key: DomainKey) => void
}

/**
 * The sideNav rail.
 *
 * Structure is the vendored `settings-dialog.tsx` demo's (Sidebar
 * collapsible="none" inside a SidebarProvider with items-start), with its
 * hard-coded nav list replaced by the domain registry.
 *
 * The demo's `<a href="#">` wrappers are dropped: these are buttons, not
 * links. There is no route behind a domain — the window owns its own state —
 * and an anchor invites a middle-click that opens a blank page.
 */
export function DomainNav({ domains, active, onSelect }: DomainNavProps) {
  return (
    <Sidebar collapsible="none" className="hidden w-48 shrink-0 border-r border-border md:flex">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {domains.map((d) => (
                <SidebarMenuItem key={d.key}>
                  <SidebarMenuButton
                    isActive={d.key === active}
                    aria-current={d.key === active ? "page" : undefined}
                    onClick={() => onSelect(d.key)}
                  >
                    <d.icon />
                    <span>{d.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}

/**
 * The same choice as a Select, for windows too narrow for a rail.
 *
 * Same state and same handler — only the control differs. The demo hides its
 * sidebar below `md` and offers nothing in its place, which would strand a
 * phone user in whichever domain they last opened.
 */
export function DomainSelect({ domains, active, onSelect }: DomainNavProps) {
  return (
    <Select value={active} onValueChange={(v) => onSelect(v as DomainKey)}>
      <SelectTrigger size="sm" className="h-8 w-40 text-xs md:hidden" aria-label="Domain">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {domains.map((d) => (
          <SelectItem key={d.key} value={d.key}>
            {d.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
