"use client"

import { useEffect, useRef, useState } from "react"
import { ArchiveIcon, ArchiveRestoreIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import type { ConversationFilter, PublicConversation } from "@/lib/agent/types"

const SHELVES: { value: ConversationFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
]

export function ConversationRail({
  conversations,
  status,
  error,
  activeId,
  shelf,
  hasMore,
  onSelect,
  onNew,
  onShelfChange,
  onLoadMore,
  onRename,
  onArchive,
  onDelete,
}: {
  conversations: PublicConversation[]
  status: "idle" | "loading" | "ready" | "error"
  error: string | null
  activeId: string | null
  shelf: ConversationFilter
  hasMore: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onShelfChange: (shelf: ConversationFilter) => void
  onLoadMore: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string, archived: boolean) => void
  onDelete: (id: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  // Two-step delete, inline. The workspace's ConfirmWindow is built around
  // DomainTableConfig row semantics (ids + endpoint + useRecordMutations);
  // opening a whole window to remove one row from the terminal's own rail is
  // heavier coupling than the interaction warrants.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  return (
    <div className="flex h-full min-h-0 w-56 shrink-0 flex-col border-r border-border">
      <div className="shrink-0 p-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-1.5 text-xs"
          onClick={onNew}
        >
          <PlusIcon className="size-3.5" />
          New chat
        </Button>
      </div>

      <div
        role="tablist"
        aria-label="Conversation shelf"
        className="mx-2 mb-1 flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5"
      >
        {SHELVES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="tab"
            aria-selected={shelf === s.value}
            onClick={() => onShelfChange(s.value)}
            className={cn(
              "flex-1 rounded-sm px-2 py-1 text-xs transition-colors",
              shelf === s.value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {status === "loading" && (
          <div className="flex flex-col gap-1.5 pt-1">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )}

        {status === "error" && (
          <p role="alert" className="px-1 py-2 text-xs text-destructive">
            {error ?? "Could not load conversations"}
          </p>
        )}

        {status === "ready" && conversations.length === 0 && (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {shelf === "archived" ? "Nothing archived." : "No conversations yet."}
          </p>
        )}

        {conversations.map((c) =>
          renaming === c.id ? (
            <RenameField
              key={c.id}
              initial={c.title ?? ""}
              onCommit={(title) => {
                setRenaming(null)
                onRename(c.id, title)
              }}
              onCancel={() => setRenaming(null)}
            />
          ) : (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-0.5 rounded-md",
                c.id === activeId && "bg-accent text-accent-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(c.id)}
                aria-current={c.id === activeId ? "true" : undefined}
                className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
              >
                {c.title ?? "Untitled"}
              </button>

              <DropdownMenu
                open={confirmingDelete === c.id ? true : undefined}
                onOpenChange={(open) => {
                  // Reopening the menu must not keep the armed confirm from a
                  // previous open, or a stray second click deletes.
                  if (!open) setConfirmingDelete(null)
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Actions for ${c.title ?? "Untitled"}`}
                    className="mr-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 hover:text-foreground"
                  >
                    <MoreHorizontalIcon className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => setRenaming(c.id)}>
                    <PencilIcon className="size-3.5" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => onArchive(c.id, c.status !== "archived")}
                  >
                    {c.status === "archived" ? (
                      <>
                        <ArchiveRestoreIcon className="size-3.5" />
                        Unarchive
                      </>
                    ) : (
                      <>
                        <ArchiveIcon className="size-3.5" />
                        Archive
                      </>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    // `preventDefault` keeps the menu open so the confirming
                    // label is actually readable before the second click.
                    onSelect={(e) => {
                      if (confirmingDelete !== c.id) {
                        e.preventDefault()
                        setConfirmingDelete(c.id)
                        return
                      }
                      setConfirmingDelete(null)
                      onDelete(c.id)
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                    {confirmingDelete === c.id ? "Click again to delete" : "Delete"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ),
        )}

        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 w-full text-xs text-muted-foreground"
            onClick={onLoadMore}
          >
            Load more
          </Button>
        )}
      </div>
    </div>
  )
}

/** Inline rename. Enter commits, Escape abandons, blur commits. */
function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (title: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  // Committed through a ref so the blur handler cannot fire a second time after
  // Enter has already committed and unmounted the field.
  const done = useRef(false)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      value={value}
      maxLength={500}
      aria-label="Conversation title"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (done.current) return
        done.current = true
        onCommit(value)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          done.current = true
          onCommit(value)
        } else if (e.key === "Escape") {
          done.current = true
          onCancel()
        }
      }}
      className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-ring"
    />
  )
}
