'use client'

import * as React from 'react'
import { RecordToolbar } from '@/components/data-management/record-toolbar'
import { RecordDataTable } from '@/components/data-management/record-data-table'
import { RecordInputPanel } from '@/components/data-management/record-input-panel'
import { RecordDetailDrawer } from '@/components/data-management/record-detail-drawer'
import { RecordDeleteDialog } from '@/components/data-management/record-delete-dialog'
import { CollectionManagerDialog } from '@/components/data-management/collection-manager-dialog'
import { useCollections } from '@/lib/hooks/use-collections'
import { useCollectionDefinition } from '@/lib/hooks/use-collection-definition'
import { useRecords } from '@/lib/hooks/use-records'
import { useQueryUrlSync } from '@/lib/hooks/use-query-url-sync'
import {
  useCollection,
  useDataManagementStore,
  useSetCollection,
} from '@/lib/state-management/data-management.store'

export function DataManagementView() {
  useQueryUrlSync()

  const { collections } = useCollections()
  const collection = useCollection()
  const setCollection = useSetCollection()
  const { fields, isLoading: defLoading } = useCollectionDefinition(collection)
  const { results, isLoading, error, mutate } = useRecords()

  // Default to the first collection once the list resolves (unless the URL already set one).
  // Read the live store value at effect-run time rather than the closed-over
  // `collection`: useQueryUrlSync() hydrates the store synchronously earlier
  // in this component's render, so under a warm useCollections() cache this
  // effect can otherwise run with a stale (null) `collection` and clobber a
  // collection that was just hydrated from `?collection=`.
  React.useEffect(() => {
    if (collections.length > 0 && !useDataManagementStore.getState().collection) {
      setCollection(collections[0].name)
    }
  }, [collections, setCollection])

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Data Management</h1>
        <p className="text-sm text-muted-foreground">
          Create, search, and manage records across your collections.
        </p>
      </div>

      <RecordToolbar fields={fields} facetDistribution={results?.facetDistribution} />

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
          <RecordDetailDrawer fields={fields} collection={collection} />
          <RecordDeleteDialog />
        </>
      )}

      <CollectionManagerDialog />
    </div>
  )
}
