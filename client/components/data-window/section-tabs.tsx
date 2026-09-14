"use client"

import { EllipsisIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SectionSpec } from "./types"

export interface SectionTabsProps {
  sections: SectionSpec[]
  active: string
  onSelect: (key: string) => void
}

/**
 * The schema tabs for one domain.
 *
 * This is the SECOND of the three navigation levels, and the one most easily
 * confused with the third: these switch endpoint (Transactions → Invoices),
 * while `DomainTableConfig.tabs` inside the table's own toolbar switch one
 * query param over a single endpoint (All → Overdue). Keeping them in
 * different places is what makes two tab rows legible rather than baffling.
 *
 * Domains with many resources (Finance has eight) would need a scrolling tab
 * row that hides its own navigation, so reference and vocabulary sections are
 * marked `secondary` and live in an overflow menu instead.
 */
export function SectionTabs({ sections, active, onSelect }: SectionTabsProps) {
  const primary = sections.filter((s) => !s.secondary)
  const secondary = sections.filter((s) => s.secondary)
  const activeSection = sections.find((s) => s.key === active)

  // An active secondary section is promoted into the row for as long as it is
  // active. Without this the tab row shows no selection at all and the user
  // cannot see where they are.
  const shown =
    activeSection?.secondary && !primary.some((s) => s.key === active)
      ? [...primary, activeSection]
      : primary

  // One section is not a choice.
  if (sections.length < 2) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 pb-2">
      <Tabs value={active} onValueChange={onSelect} className="min-w-0">
        <TabsList className="h-8 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {shown.map((s) => (
            <TabsTrigger key={s.key} value={s.key} className="text-xs">
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {secondary.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label="More sections"
            >
              <EllipsisIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            {secondary.map((s) => (
              <DropdownMenuCheckboxItem
                key={s.key}
                checked={s.key === active}
                onCheckedChange={() => onSelect(s.key)}
              >
                {s.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
