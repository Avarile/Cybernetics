"use client"

import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModalAction {
  label: string
  onClick: () => void
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost"
  disabled?: boolean
  loading?: boolean
}

export interface GlobalModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  /** Main body of the modal */
  children: React.ReactNode
  /** Buttons rendered in the footer (right-aligned) */
  actions?: ModalAction[]
  /** Extra width override — default is max-w-lg */
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}

const SIZE_CLASS: Record<NonNullable<GlobalModalProps["size"]>, string> = {
  sm: "sm:max-w-lg",
  md: "sm:max-w-2xl",
  lg: "sm:max-w-4xl",
  xl: "sm:max-w-6xl",
}

// ─── GlobalModal ──────────────────────────────────────────────────────────────

export function GlobalModal({
  open,
  onClose,
  title,
  description,
  children,
  actions = [],
  size = "md",
  className,
}: GlobalModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className={cn("w-full max-w-full flex flex-col max-h-[90vh]", SIZE_CLASS[size], className)}>
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="py-2 overflow-y-auto min-h-0 flex-1">{children}</div>

        {actions.length > 0 && (
          <DialogFooter className="gap-2">
            {actions.map((action) => (
              <Button
                key={action.label}
                variant={action.variant ?? "default"}
                onClick={action.onClick}
                disabled={action.disabled || action.loading}
              >
                {action.loading ? "Saving…" : action.label}
              </Button>
            ))}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Confirm Delete Dialog ────────────────────────────────────────────────────
// Lightweight destructive confirmation — no form, just a prompt.

export interface ConfirmDeleteProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  label?: string
  loading?: boolean
}

export function ConfirmDelete({
  open,
  onClose,
  onConfirm,
  label = "this item",
  loading = false,
}: ConfirmDeleteProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full max-w-full sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {label}</DialogTitle>
          <DialogDescription>
            This action cannot be undone. Are you sure you want to delete{" "}
            <span className="font-medium">{label}</span>?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={loading}>
            {loading ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
