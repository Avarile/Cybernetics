import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const remove = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/hooks/use-record-mutations', () => ({ useRecordMutations: () => ({ remove, create: vi.fn(), update: vi.fn(), reindex: vi.fn() }) }))

import { RecordDeleteDialog } from '@/components/data-management/record-delete-dialog'
import { useDataManagementStore } from '@/lib/state-management/data-management.store'

beforeEach(() => {
  vi.clearAllMocks()
  useDataManagementStore.setState({ deleteTarget: ['r1', 'r2'], selection: { r1: true, r2: true } })
})

describe('RecordDeleteDialog', () => {
  it('confirms deletion of the targeted ids and clears state', async () => {
    render(<RecordDeleteDialog />)
    expect(screen.getByText(/delete 2 record/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(['r1', 'r2']))
    await waitFor(() => expect(useDataManagementStore.getState().deleteTarget).toBeNull())
    expect(useDataManagementStore.getState().selection).toEqual({})
  })
})
