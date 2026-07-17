'use client'

import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { RecordForm } from '@/components/data-management/record-form'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordInputPanel({ fields, collection }: { fields: FieldSpec[]; collection: string }) {
  const open = useDataManagementStore((s) => s.panel === 'create')
  const closeCreate = useDataManagementStore((s) => s.closeCreate)

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) closeCreate() }}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>New record</SheetTitle>
          <SheetDescription>Add a record to “{collection}”.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {open && (
            <RecordForm fields={fields} collection={collection} mode="create" onDone={closeCreate} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
