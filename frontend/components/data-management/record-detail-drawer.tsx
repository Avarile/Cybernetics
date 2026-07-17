'use client'

import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { RecordForm } from '@/components/data-management/record-form'
import { FieldCell } from '@/components/data-management/field-cell'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec, RecordHit, SearchResults } from '@/lib/interfaces/search.interface'

export function RecordDetailDrawer({
  fields,
  collection,
  results,
}: {
  fields: FieldSpec[]
  collection: string
  results?: SearchResults
}) {
  const isAdmin = useIsAdmin()
  const detailId = useDataManagementStore((s) => s.detailId)
  const closeDetail = useDataManagementStore((s) => s.closeDetail)

  const record: RecordHit | undefined = results?.hits.find((h) => h.id === detailId)
  const editable = isAdmin && !!record?.externalId

  return (
    <Drawer open={detailId !== null} onOpenChange={(o) => { if (!o) closeDetail() }} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{editable ? 'Edit record' : 'Record details'}</DrawerTitle>
          <DrawerDescription>
            {record?.externalId ? `External ID: ${record.externalId}` : 'This record has no external ID and is read-only.'}
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6">
          {record && editable ? (
            <RecordForm fields={fields} collection={collection} mode="edit" record={record} onDone={closeDetail} />
          ) : record ? (
            <dl className="flex flex-col gap-3">
              {fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-1">
                  <dt className="text-sm font-medium text-muted-foreground">{f.name}</dt>
                  <dd><FieldCell field={f} value={record[f.name]} /></dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
