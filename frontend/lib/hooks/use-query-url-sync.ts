'use client'
import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

/** Two-way projection between the URL and the data-management store. */
export function useQueryUrlSync() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const store = useDataManagementStore((s) => s)
  const hydrated = React.useRef(false)
  const justHydrated = React.useRef(false)

  React.useEffect(() => {
    if (hydrated.current) return
    hydrated.current = true
    const collection = params.get('collection')
    const q = params.get('q')
    const page = params.get('page')
    const sort = params.get('sort')
    const record = params.get('record')
    if (collection) store.setCollection(collection)
    if (q) store.setSearch(q)
    if (page) store.setPage(Number(page) || 1)
    if (sort) {
      const [field, dir] = sort.split(':')
      if (field && (dir === 'asc' || dir === 'desc')) {
        store.toggleSort(field)                 // → asc
        if (dir === 'desc') store.toggleSort(field) // → desc
      }
    }
    if (record) store.openDetail(record)
    justHydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    if (!hydrated.current) return
    // Skip the write-back exactly once, on the hydration commit: this effect's
    // closure still holds the pre-hydration store (collection null, q '', etc.)
    // because it ran in the same commit as the hydration effect above. Running
    // it here would strip deep-link params before the hydrated state
    // propagates. The store setters trigger a re-render, and this effect runs
    // again with the fresh, hydrated store — reproducing the same URL.
    if (justHydrated.current) {
      justHydrated.current = false
      return
    }
    const next = new URLSearchParams()
    if (store.collection) next.set('collection', store.collection)
    if (store.q) next.set('q', store.q)
    if (store.page > 1) next.set('page', String(store.page))
    if (store.sort[0]) next.set('sort', `${store.sort[0].field}:${store.sort[0].dir}`)
    if (store.detailId) next.set('record', store.detailId)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [store.collection, store.q, store.page, store.sort, store.detailId, pathname, router])
}
