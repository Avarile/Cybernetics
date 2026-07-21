'use client'

import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { CollectionEditorSheet } from '@/components/data-management/collection-editor-sheet'
import { useCollections } from '@/lib/hooks/use-collections'
import { useCollectionMutations } from '@/lib/hooks/use-collection-mutations'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

export function CollectionManagerDialog() {
  const panel = useDataManagementStore((s) => s.collectionPanel)
  const openCreate = useDataManagementStore((s) => s.openCreateCollection)
  const openEdit = useDataManagementStore((s) => s.openEditCollection)
  const close = useDataManagementStore((s) => s.closeCollectionPanel)
  const { collections } = useCollections()
  const { remove } = useCollectionMutations()
  const editing = panel.kind === 'edit' ? panel.name : undefined

  return (
    <>
      <Dialog open={panel.kind === 'list'} onOpenChange={(o) => { if (!o) close() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Collections</DialogTitle>
            <DialogDescription>Create, edit, or delete collections.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {collections.map((c) => (
              <div key={c.name} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">{c.displayName}</div>
                  <div className="text-xs text-muted-foreground">{c.name} · {c.fields.length} fields</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(c.name)}>Edit</Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="sm">Delete</Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete “{c.displayName}”?</AlertDialogTitle>
                        <AlertDialogDescription>This drops the search index and soft-deletes all its records.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void remove(c.name)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={openCreate} className="self-start">New collection</Button>
          </div>
        </DialogContent>
      </Dialog>

      <CollectionEditorSheet
        open={panel.kind === 'create' || panel.kind === 'edit'}
        mode={panel.kind === 'edit' ? 'edit' : 'create'}
        name={editing}
        onClose={close}
      />
    </>
  )
}
