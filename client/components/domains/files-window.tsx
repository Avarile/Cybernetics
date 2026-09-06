"use client"

import { useCallback, useMemo, useState } from "react"
import { DownloadIcon } from "lucide-react"
import { DataTable } from "@/components/data-table/data-table"
import { useApi } from "@/lib/api/provider"
import { useWindowStore } from "@/stores/window.store"
import { FileDropzone } from "./file-dropzone"
import { filesConfig, type FileRow } from "./files.config"

export function FilesWindow() {
  const { client } = useApi()
  const openWindow = useWindowStore((s) => s.openWindow)
  const [refreshToken, setRefreshToken] = useState(0)

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), [])

  const config = useMemo(
    () => ({
      ...filesConfig,
      toolbarExtra: <FileDropzone onUploaded={refresh} />,
      rowActions: [
        {
          label: "Download",
          icon: DownloadIcon,
          onSelect: (row: FileRow) => {
            // Presigned and short-lived, so it is fetched at click time rather
            // than embedded in the row.
            void client
              .get<{ url: string }>(`/files/${row.id}/download-url`)
              .then(({ url }) => window.open(url, "_blank", "noopener"))
          },
        },
      ],
    }),
    [client, refresh],
  )

  return (
    <DataTable
      config={config}
      refreshToken={refreshToken}
      onDelete={(rows) =>
        openWindow({
          kind: "confirm",
          title: rows.length === 1 ? "Delete file" : "Delete files",
          modal: true,
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
