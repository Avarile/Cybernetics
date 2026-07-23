'use client'

import * as React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Upload01Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

export function FileDropzone({
  onFiles, disabled = false,
}: {
  onFiles: (files: File[]) => void
  disabled?: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <div
      data-testid="file-dropzone"
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
      }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) emit(e.dataTransfer.files)
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors',
        dragging ? 'border-primary bg-primary/5' : 'border-input',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted/50',
      )}
    >
      <HugeiconsIcon icon={Upload01Icon} strokeWidth={2} className="size-6 text-muted-foreground" />
      <div className="text-sm font-medium">Drag files here or click to browse</div>
      <div className="text-xs text-muted-foreground">Files are hashed locally before upload</div>
      <input
        ref={inputRef}
        data-testid="file-input"
        type="file"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => { emit(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
