// lib/state-management/__tests__/file-management.store.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useFileManagementStore } from '@/lib/state-management/file-management.store'

const reset = () =>
  useFileManagementStore.setState({
    status: 'ALL', mimeType: undefined, page: 1, limit: 20, nameFilter: '',
    selection: {}, columnVisibility: {}, uploadOpen: false, detailId: null,
    deleteTarget: null, watchUntil: 0,
  })

beforeEach(reset)

describe('file-management store', () => {
  it('setStatus resets page and selection', () => {
    useFileManagementStore.setState({ page: 5, selection: { a: true } })
    useFileManagementStore.getState().setStatus('QUARANTINED')
    const s = useFileManagementStore.getState()
    expect(s.status).toBe('QUARANTINED')
    expect(s.page).toBe(1)
    expect(s.selection).toEqual({})
  })

  it('setMimeType resets page', () => {
    useFileManagementStore.setState({ page: 3 })
    useFileManagementStore.getState().setMimeType('application/pdf')
    expect(useFileManagementStore.getState().page).toBe(1)
    expect(useFileManagementStore.getState().mimeType).toBe('application/pdf')
  })

  it('setSelection accepts a functional updater', () => {
    useFileManagementStore.getState().setSelection(() => ({ x: true }))
    expect(useFileManagementStore.getState().selection).toEqual({ x: true })
  })

  it('requestDelete/cancelDelete toggle the target', () => {
    useFileManagementStore.getState().requestDelete(['a', 'b'])
    expect(useFileManagementStore.getState().deleteTarget).toEqual(['a', 'b'])
    useFileManagementStore.getState().cancelDelete()
    expect(useFileManagementStore.getState().deleteTarget).toBeNull()
  })

  it('startWatch sets watchUntil into the future', () => {
    const before = Date.now()
    useFileManagementStore.getState().startWatch()
    expect(useFileManagementStore.getState().watchUntil).toBeGreaterThanOrEqual(before + 19_000)
  })
})
