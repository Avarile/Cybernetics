"use client"

import { useRef, useState } from "react"
import { AlertTriangleIcon, CheckIcon, UploadIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useFileUploads } from "@/features/files/use-file-uploads"
import { INGESTABLE_MIMES } from "@/lib/files/upload"
import { cn } from "@/lib/utils"
import { isSettled, type UploadItem } from "@/stores/upload.store"

const PHASE_LABEL: Record<UploadItem["phase"], string> = {
  queued: "Queued",
  hashing: "Hashing",
  uploading: "Uploading",
  completing: "Finalising",
  processing: "Processing",
  indexed: "Indexed",
  failed: "Failed",
}

export function FileDropzone() {
  // Presentation state for this one element — it has no business in a store.
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { items, start, remove, clearSettled } = useFileUploads()

  return (
    <div className="shrink-0 pb-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) void start(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
        )}
      >
        <UploadIcon className="size-4 text-muted-foreground" />
        <p className="text-xs text-foreground">Drop files here, or click to choose</p>
        <p className="text-[11px] text-muted-foreground">
          PDF, DOCX, Markdown and plain text become searchable. Other types are stored only.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          // A hint, not a gate: other types are still accepted and stored.
          accept={INGESTABLE_MIMES.join(",")}
          onChange={(e) => {
            if (e.target.files?.length) void start(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {items.length} file{items.length === 1 ? "" : "s"}
            </span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-[11px]"
              onClick={clearSettled}
            >
              Clear finished
            </Button>
          </div>

          {items.map((item) => (
            <div
              key={item.localId}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-xs">{item.filename}</span>
                  {!item.ingestable && (
                    <span
                      title="Stored, but this type is not extracted into searchable text"
                      className="flex items-center gap-0.5 text-[10px] text-muted-foreground"
                    >
                      <AlertTriangleIcon className="size-3" /> not indexed
                    </span>
                  )}
                  {item.deduplicated && (
                    <span className="text-[10px] text-muted-foreground">already stored</span>
                  )}
                </div>
                {item.phase === "uploading" ? (
                  <Progress value={item.percent} className="mt-1 h-1" />
                ) : (
                  <span
                    className={cn(
                      "text-[10px]",
                      item.phase === "failed" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {item.error ?? PHASE_LABEL[item.phase]}
                  </span>
                )}
              </div>

              {item.phase === "indexed" && <CheckIcon className="size-3.5 text-green-600" />}
              {isSettled(item.phase) && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={`Dismiss ${item.filename}`}
                  onClick={() => remove(item.localId)}
                >
                  <XIcon className="size-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
