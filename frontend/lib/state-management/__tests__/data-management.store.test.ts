import { describe, it, expect, beforeEach } from 'vitest'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

const get = () => useDataManagementStore.getState()

beforeEach(() => {
  useDataManagementStore.setState({
    collection: 'products', q: '', page: 1, limit: 20, filters: {}, sort: [],
    selection: {}, columnVisibility: {}, panel: 'closed', detailId: null, deleteTarget: null,
    collectionPanel: { kind: 'closed' },
  })
})

describe('data-management store', () => {
  it('setSearch resets page to 1', () => {
    get().setPage(5)
    get().setSearch('laptop')
    expect(get().q).toBe('laptop')
    expect(get().page).toBe(1)
  })

  it('toggleSort cycles asc → desc → off', () => {
    get().toggleSort('price')
    expect(get().sort).toEqual([{ field: 'price', dir: 'asc' }])
    get().toggleSort('price')
    expect(get().sort).toEqual([{ field: 'price', dir: 'desc' }])
    get().toggleSort('price')
    expect(get().sort).toEqual([])
  })

  it('toggleSort on a new field replaces the previous sort', () => {
    get().toggleSort('price')
    get().toggleSort('name')
    expect(get().sort).toEqual([{ field: 'name', dir: 'asc' }])
  })

  it('additive toggleSort keeps prior sorts', () => {
    get().toggleSort('price')
    get().toggleSort('name', true)
    expect(get().sort).toEqual([{ field: 'price', dir: 'asc' }, { field: 'name', dir: 'asc' }])
    get().toggleSort('price', true)
    expect(get().sort).toEqual([{ field: 'price', dir: 'desc' }, { field: 'name', dir: 'asc' }])
  })

  it('non-additive toggleSort still replaces', () => {
    get().toggleSort('price'); get().toggleSort('name')
    expect(get().sort).toEqual([{ field: 'name', dir: 'asc' }])
  })

  it('setFilter adds then clears, resetting page each time', () => {
    get().setPage(3)
    get().setFilter('status', ['active'])
    expect(get().filters).toEqual({ status: ['active'] })
    expect(get().page).toBe(1)
    get().setFilter('status', undefined)
    expect(get().filters).toEqual({})
  })

  it('setCollection resets query and selection', () => {
    get().setSearch('x'); get().setFilter('a', 1); get().setSelection({ r1: true })
    get().setCollection('orders')
    expect(get().collection).toBe('orders')
    expect(get().q).toBe('')
    expect(get().filters).toEqual({})
    expect(get().selection).toEqual({})
  })

  it('setSelection supports functional updaters', () => {
    get().setSelection({ r1: true })
    get().setSelection((prev) => ({ ...prev, r2: true }))
    expect(get().selection).toEqual({ r1: true, r2: true })
  })

  it('dialog actions toggle panel / detail / delete state', () => {
    get().openCreate(); expect(get().panel).toBe('create')
    get().closeCreate(); expect(get().panel).toBe('closed')
    get().openDetail('r1'); expect(get().detailId).toBe('r1')
    get().requestDelete(['r1', 'r2']); expect(get().deleteTarget).toEqual(['r1', 'r2'])
    get().cancelDelete(); expect(get().deleteTarget).toBeNull()
  })

  it('collection panel transitions', () => {
    get().openCollections(); expect(get().collectionPanel).toEqual({ kind: 'list' })
    get().openEditCollection('products'); expect(get().collectionPanel).toEqual({ kind: 'edit', name: 'products' })
    get().closeCollectionPanel(); expect(get().collectionPanel).toEqual({ kind: 'closed' })
  })
})
