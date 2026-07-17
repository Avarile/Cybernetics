'use client'

import * as React from 'react'
import { RecordToolbar } from '@/components/data-management/record-toolbar'
import { RecordDataTable } from '@/components/data-management/record-data-table'
import { RecordInputPanel } from '@/components/data-management/record-input-panel'
import { RecordDetailDrawer } from '@/components/data-management/record-detail-drawer'
import { RecordDeleteDialog } from '@/components/data-management/record-delete-dialog'
import { useCollections } from '@/lib/hooks/use-collections'
import { useCollectionDefinition } from '@/lib/hooks/use-collection-definition'
import { useRecords } from '@/lib/hooks/use-records'
import { useCollection, useSetCollection } from '@/lib/state-management/data-management.store'

export function DataManagementView() {
  const { collections } = useCollections()
  const collection = useCollection()
  const setCollection = useSetCollection()
  const { fields, isLoading: defLoading } = useCollectionDefinition(collection)
  const { results, isLoading, error, mutate } = useRecords()

  // Default to the first collection once the list resolves.
  React.useEffect(() => {
    if (!collection && collections.length > 0) setCollection(collections[0].name)
  }, [collection, collections, setCollection])

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Data Management</h1>
        <p className="text-sm text-muted-foreground">
          Create, search, and manage records across your collections.
        </p>
      </div>

      <RecordToolbar fields={fields} />

      <RecordDataTable
        fields={fields}
        results={results}
        isLoading={isLoading || defLoading}
        error={error}
        onRetry={() => void mutate()}
      />

      {collection && (
        <>
          <RecordInputPanel fields={fields} collection={collection} />
          <RecordDetailDrawer fields={fields} collection={collection} results={results} />
          <RecordDeleteDialog />
        </>
      )}
    </div>
  )
}
