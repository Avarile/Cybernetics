"use client"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PAGE_SIZES, pageCount } from "./query"

/**
 * Selected count, rows-per-page and the pager.
 *
 * Structure follows the demo `data-table.tsx` footer, but every control drives
 * the server query rather than a client-side row model.
 */
export function TablePagination({
  page,
  limit,
  total,
  selectedCount,
  onPage,
  onLimit,
}: {
  page: number
  limit: number
  total: number
  selectedCount: number
  onPage: (page: number) => void
  onLimit: (limit: number) => void
}) {
  const pages = pageCount(total, limit)
  const canPrev = page > 1
  const canNext = page < pages

  return (
    <div className="flex items-center justify-between px-1 pt-3">
      <div className="hidden flex-1 text-xs text-muted-foreground lg:flex">
        {selectedCount > 0
          ? `${selectedCount} of ${total} row(s) selected.`
          : `${total} row${total === 1 ? "" : "s"}`}
      </div>

      <div className="flex w-full items-center gap-6 lg:w-fit">
        <div className="hidden items-center gap-2 lg:flex">
          <Label htmlFor="rows-per-page" className="text-xs font-medium">
            Rows per page
          </Label>
          <Select value={String(limit)} onValueChange={(v) => onLimit(Number(v))}>
            <SelectTrigger size="sm" className="w-18" id="rows-per-page">
              <SelectValue placeholder={limit} />
            </SelectTrigger>
            <SelectContent side="top">
              <SelectGroup>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex w-fit items-center justify-center text-xs font-medium">
          Page {page} of {pages}
        </div>

        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <Button
            variant="outline"
            size="icon"
            className="hidden size-7 lg:flex"
            onClick={() => onPage(1)}
            disabled={!canPrev}
          >
            <span className="sr-only">Go to first page</span>
            <ChevronsLeftIcon className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => onPage(page - 1)}
            disabled={!canPrev}
          >
            <span className="sr-only">Go to previous page</span>
            <ChevronLeftIcon className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            onClick={() => onPage(page + 1)}
            disabled={!canNext}
          >
            <span className="sr-only">Go to next page</span>
            <ChevronRightIcon className="size-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="hidden size-7 lg:flex"
            onClick={() => onPage(pages)}
            disabled={!canNext}
          >
            <span className="sr-only">Go to last page</span>
            <ChevronsRightIcon className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
