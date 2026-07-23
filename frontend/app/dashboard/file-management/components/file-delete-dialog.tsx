'use client'

import * as React from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'
import { useFileMutations } from '@/lib/hooks/use-file-mutations'

export function FileDeleteDialog() {
  const deleteTarget = useFileManagementStore((s) => s.deleteTarget)
  const cancelDelete = useFileManagementStore((s) => s.cancelDelete)
  const clearSelection = useFileManagementStore((s) => s.clearSelection)
  const closeDetail = useFileManagementStore((s) => s.closeDetail)
  const { remove } = useFileMutations()
  const [busy, setBusy] = React.useState(false)

  const count = deleteTarget?.length ?? 0

  const confirm = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const { ok, failed } = await remove(deleteTarget)
      if (failed === 0) toast.success(`Deleted ${ok} file(s)`)
      else toast.error(`Deleted ${ok} of ${ok + failed}; ${failed} failed`)
      clearSelection()
      closeDetail()
      cancelDelete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) cancelDelete() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} file(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the selected file(s). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void confirm() }}>
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
