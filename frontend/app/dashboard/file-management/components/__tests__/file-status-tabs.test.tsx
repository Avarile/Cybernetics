import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const setStatus = vi.fn()
vi.mock('@/lib/state-management/file-management.store', () => ({
  useFileStatus: () => 'ALL',
  useFileManagementStore: (sel: (s: unknown) => unknown) => sel({ setStatus }),
}))
vi.mock('swr', () => ({ default: () => ({ data: 2 }) }))

import { FileStatusTabs } from '@/app/dashboard/file-management/components/file-status-tabs'

beforeEach(() => vi.clearAllMocks())

describe('FileStatusTabs', () => {
  it('renders all four tabs with the quarantine count', () => {
    render(<FileStatusTabs />)
    expect(screen.getByRole('tab', { name: /all/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /quarantined/i })).toHaveTextContent('2')
  })
  it('switches status on click', async () => {
    render(<FileStatusTabs />)
    await userEvent.click(screen.getByRole('tab', { name: /available/i }))
    expect(setStatus).toHaveBeenCalledWith('AVAILABLE')
  })
})
