"use client"

import { useMemo } from "react"
import { DownloadIcon } from "lucide-react"
import { DataTable } from "@/components/data-table/data-table"
import { useFileDownload } from "@/features/files/use-file-download"
import { useWorkspace } from "@/features/workspace/use-workspace"
import { FileDropzone } from "./file-dropzone"
import { filesConfig, type FileRow } from "./files.config"

export function FilesWindow() {
  const download = useFileDownload()
  const { openWindow } = useWorkspace()

  const config = useMemo(
    () => ({
      ...filesConfig,
      // The dropzone invalidates its own list through SWR (useFileUploads),
      // so a finished upload here is visible in every open Files window.
      toolbarExtra: <FileDropzone />,
      rowActions: [
        {
          label: "Download",
          icon: DownloadIcon,
          onSelect: (row: FileRow) => void download(row.id),
        },
      ],
    }),
    // `download` is a `useCallback` in the hook, so this memo only rebuilds
    // when the API client itself does.
    [download],
  )

  return (
    <DataTable
      config={config}
      onDelete={(rows) =>
        openWindow({
          kind: "confirm",
          title: rows.length === 1 ? "Delete file" : "Delete files",
          singletonKey: `confirm:files:${rows.map((r) => r.id).join(",")}`,
          props: {
            message: `Delete ${rows.length} file${rows.length === 1 ? "" : "s"}? This cannot be undone.`,
            confirmLabel: "Delete",
            destructive: true,
            ids: rows.map((r) => r.id),
            endpoint: "/files",
          },
        })
      }
    />
  )
}
