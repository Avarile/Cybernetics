'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * variant     – visual animation style
 * size        – overall scale of the indicator
 * mode        – how the loader is positioned in the layout
 * label       – primary text shown below the indicator
 * description – secondary/detail text
 */
export interface GlobalLoadingProps {
  variant?: 'spinner' | 'dots' | 'bars' | 'pulse'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  mode?: 'inline' | 'overlay' | 'fullscreen' | 'page'
  label?: string
  description?: string
  className?: string
}

// ─── Size tokens ──────────────────────────────────────────────────────────────

const SIZE_TOKENS = {
  sm: {
    spinner:    'size-4 border-2',
    dot:        'size-1.5',
    bar:        'w-0.5',
    barHeights: ['h-2', 'h-3', 'h-4', 'h-3', 'h-2'],
    pulse:      'size-5',
    label:      'text-xs',
    desc:       'text-[11px]',
    gap:        'gap-1.5',
  },
  md: {
    spinner:    'size-8 border-2',
    dot:        'size-2',
    bar:        'w-1',
    barHeights: ['h-3', 'h-5', 'h-7', 'h-5', 'h-3'],
    pulse:      'size-10',
    label:      'text-sm',
    desc:       'text-xs',
    gap:        'gap-2',
  },
  lg: {
    spinner:    'size-12 border-[3px]',
    dot:        'size-3',
    bar:        'w-1',
    barHeights: ['h-4', 'h-7', 'h-10', 'h-7', 'h-4'],
    pulse:      'size-14',
    label:      'text-base',
    desc:       'text-sm',
    gap:        'gap-3',
  },
  xl: {
    spinner:    'size-16 border-4',
    dot:        'size-4',
    bar:        'w-1.5',
    barHeights: ['h-5', 'h-9', 'h-14', 'h-9', 'h-5'],
    pulse:      'size-20',
    label:      'text-lg',
    desc:       'text-sm',
    gap:        'gap-4',
  },
} as const

type Size = keyof typeof SIZE_TOKENS

// ─── Indicators ───────────────────────────────────────────────────────────────

function SpinnerIndicator({ size }: { size: Size }) {
  const t = SIZE_TOKENS[size]
  return (
    <div
      className={cn(
        'animate-spin rounded-full border-border border-t-foreground',
        t.spinner,
      )}
    />
  )
}

function DotsIndicator({ size }: { size: Size }) {
  const t = SIZE_TOKENS[size]
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={cn('animate-bounce rounded-full bg-foreground', t.dot)}
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  )
}

function BarsIndicator({ size }: { size: Size }) {
  const t = SIZE_TOKENS[size]
  const delays = [0, 0.1, 0.2, 0.1, 0]
  return (
    <div className="flex items-end gap-0.5">
      {t.barHeights.map((h, i) => (
        <div
          key={i}
          className={cn('animate-pulse rounded-sm bg-foreground', t.bar, h)}
          style={{ animationDelay: `${delays[i]}s`, animationDuration: '0.9s' }}
        />
      ))}
    </div>
  )
}

function PulseIndicator({ size }: { size: Size }) {
  const t = SIZE_TOKENS[size]
  return (
    <div className="relative flex items-center justify-center">
      <div className={cn('absolute animate-ping rounded-full bg-primary/25', t.pulse)} />
      <div className={cn('relative rounded-full bg-primary/70 scale-[0.55]', t.pulse)} />
    </div>
  )
}

const INDICATORS = {
  spinner: SpinnerIndicator,
  dots:    DotsIndicator,
  bars:    BarsIndicator,
  pulse:   PulseIndicator,
} as const

// ─── Mode layout ──────────────────────────────────────────────────────────────

const MODE_CLASS = {
  /** Sits inline — inside buttons, table cells, small containers */
  inline:
    'flex items-center justify-center',
  /** Covers the nearest `relative` parent — inside cards / sections */
  overlay:
    'absolute inset-0 z-40 flex items-center justify-center rounded-[inherit] bg-background/70 backdrop-blur-sm',
  /** Covers the entire viewport — route transitions / auth checks */
  fullscreen:
    'fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm',
  /** Fills available page space — page-level placeholder */
  page:
    'flex min-h-[40vh] w-full flex-1 items-center justify-center',
} as const

// ─── GlobalLoading ────────────────────────────────────────────────────────────

/**
 * Compose variant + size + mode for any loading scenario:
 *
 * ```tsx
 * // Full-screen route transition
 * <GlobalLoading mode="fullscreen" variant="spinner" label="Loading…" />
 *
 * // Card section overlay while refetching
 * <div className="relative">
 *   <MyCard />
 *   <GlobalLoading mode="overlay" variant="dots" size="sm" />
 * </div>
 *
 * // Inline inside a submit button
 * <button disabled>
 *   <GlobalLoading mode="inline" variant="spinner" size="sm" />
 *   Saving…
 * </button>
 *
 * // Page-level placeholder
 * <GlobalLoading mode="page" variant="pulse" size="lg" label="Fetching data…" />
 * ```
 */
export function GlobalLoading({
  variant = 'spinner',
  size = 'md',
  mode = 'page',
  label,
  description,
  className,
}: GlobalLoadingProps) {
  const Indicator = INDICATORS[variant]
  const t = SIZE_TOKENS[size]

  return (
    <div
      className={cn(MODE_CLASS[mode], className)}
      aria-busy="true"
      aria-label={label ?? 'Loading'}
    >
      <div className={cn('flex flex-col items-center', t.gap)}>
        <Indicator size={size} />

        {label && (
          <p className={cn('font-medium text-foreground', t.label)}>
            {label}
          </p>
        )}

        {description && (
          <p className={cn('text-muted-foreground', t.desc)}>
            {description}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Skeleton presets ─────────────────────────────────────────────────────────
// Drop-in placeholder layouts that mirror common UI shapes.

/** Single info card */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-3 rounded-xl border border-border bg-card p-5', className)}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="size-4 rounded" />
      </div>
      <Skeleton className="h-7 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  )
}

/** Row of stat/KPI cards (e.g. dashboard header) */
export function StatCardsSkeleton({
  count = 4,
  className,
}: {
  count?: number
  className?: string
}) {
  const colMap: Record<number, string> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  }
  return (
    <div
      className={cn(
        'grid gap-4',
        colMap[Math.min(count, 4)] ?? 'grid-cols-4',
        className,
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

/** Data table */
export function TableSkeleton({
  rows = 6,
  cols = 5,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cn('w-full space-y-2', className)}>
      {/* header */}
      <div className="flex gap-4 border-b border-border pb-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className={cn('h-3', i === 0 ? 'w-24 shrink-0' : 'flex-1')} />
        ))}
      </div>
      {/* rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-2">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn('h-3', c === 0 ? 'w-24 shrink-0' : 'flex-1')}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Avatar + text list */
export function ListSkeleton({
  rows = 5,
  className,
}: {
  rows?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Labeled form fields */
export function FormSkeleton({
  fields = 4,
  className,
}: {
  fields?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-5', className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <Skeleton className="mt-2 h-9 w-24" />
    </div>
  )
}

export default GlobalLoading
