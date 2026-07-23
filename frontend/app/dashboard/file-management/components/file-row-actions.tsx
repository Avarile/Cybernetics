'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  MoreVerticalCircle01Icon, Download01Icon, Link01Icon, InformationCircleIcon, Delete02Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { fileService } from '@/lib/services/file.service'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import type { FileMetadata } from '@/lib/interfaces/search.interface'

export function FileRowActions({ file }: { file: FileMetadata }) {
  const openDetail = useFileManagementStore((s) => s.openDetail)
  const requestDelete = useFileManagementStore((s) => s.requestDelete)
  const available = file.status === 'AVAILABLE'

  const download = async () => {
    try {
      const url = await fileService.downloadUrl(file.id)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not get a download link')
    }
  }

  const copyLink = async () => {
    try {
      const url = await fileService.downloadUrl(file.id)
      await navigator.clipboard.writeText(url)
      toast.success('Download link copied')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not copy the link')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground">
          <HugeiconsIcon icon={MoreVerticalCircle01Icon} strokeWidth={2} />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem disabled={!available} onClick={() => void download()}>
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} /> Download
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!available} onClick={() => void copyLink()}>
          <HugeiconsIcon icon={Link01Icon} strokeWidth={2} /> Copy link
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => openDetail(file.id)}>
          <HugeiconsIcon icon={InformationCircleIcon} strokeWidth={2} /> Details
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => requestDelete([file.id])}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
