'use client'

import {
  Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { Skeleton } from '@/components/ui/skeleton'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { RecordForm } from '@/components/data-management/record-form'
import { FieldCell } from '@/components/data-management/field-cell'
import { RecordStatusBadge } from '@/components/data-management/record-status-badge'
import { useIsAdmin } from '@/lib/hooks/use-permission'
import { useRecord } from '@/lib/hooks/use-record'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'
import type { FieldSpec } from '@/lib/interfaces/search.interface'

export function RecordDetailDrawer({ fields, collection }: { fields: FieldSpec[]; collection: string }) {
  const isAdmin = useIsAdmin()
  const detailId = useDataManagementStore((s) => s.detailId)
  const closeDetail = useDataManagementStore((s) => s.closeDetail)
  const { record, isLoading, error } = useRecord(collection, detailId)
  const editable = isAdmin && !!record?.externalId

  return (
    <Drawer open={detailId !== null} onOpenChange={(o) => { if (!o) closeDetail() }} direction="right">
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            {editable ? 'Edit record' : 'Record details'}
            {record && <RecordStatusBadge state={record.indexState} error={record.indexError} />}
          </DrawerTitle>
          <DrawerDescription>
            {record?.externalId
              ? `External ID: ${record.externalId}`
              : record ? 'This record has no external ID and is read-only.' : ''}
          </DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6">
          {isLoading ? (
            <div className="flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : error || !record ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Record not found</EmptyTitle>
                <EmptyDescription>It may have been deleted.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : editable ? (
            <RecordForm
              fields={fields}
              collection={collection}
              mode="edit"
              initialDocument={record.document}
              externalId={record.externalId ?? undefined}
              onDone={closeDetail}
            />
          ) : (
            <dl className="flex flex-col gap-3">
              {fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-1">
                  <dt className="text-sm font-medium text-muted-foreground">{f.name}</dt>
                  <dd><FieldCell field={f} value={record.document[f.name]} /></dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
