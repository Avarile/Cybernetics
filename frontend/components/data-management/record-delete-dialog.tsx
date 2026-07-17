'use client'

import * as React from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import { useRecordMutations } from '@/lib/hooks/use-record-mutations'

export function RecordDeleteDialog() {
  const deleteTarget = useDataManagementStore((s) => s.deleteTarget)
  const cancelDelete = useDataManagementStore((s) => s.cancelDelete)
  const clearSelection = useDataManagementStore((s) => s.clearSelection)
  const { remove } = useRecordMutations()
  const [busy, setBusy] = React.useState(false)

  const count = deleteTarget?.length ?? 0

  const confirm = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      await remove(deleteTarget)
      clearSelection()
      cancelDelete()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) cancelDelete() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {count} record(s)?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes the selected record(s). This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => { e.preventDefault(); void confirm() }}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
