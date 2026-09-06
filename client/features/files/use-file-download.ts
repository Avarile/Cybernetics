"use client"

import { useCallback } from "react"
import { useApi } from "@/lib/swr/provider"

/**
 * Opens a file's download in a new tab.
 *
 * The URL is presigned and short-lived, so it is fetched at click time rather
 * than embedded in a row that may sit on screen for minutes before anyone
 * clicks it.
 *
 * `useCallback` is load-bearing, not habit: the Files window puts this function
 * in a `useMemo` dependency array, and an identity that changed every render
 * would rebuild the whole table config every render with it.
 */
export function useFileDownload() {
  const { client } = useApi()

  return useCallback(
    async (id: string) => {
      const { url } = await client.get<{ url: string }>(`/files/${id}/download-url`)
      // `noopener` because the presigned URL is opened in a tab we do not want
      // holding a reference back to this window.
      window.open(url, "_blank", "noopener")
    },
    [client],
  )
}
