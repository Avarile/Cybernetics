import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import DashboardPage from '@/app/dashboard/page'
import { useAuthStore } from '@/lib/state-management/auth.store'

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', user: { id: 'u1', role: 'admin', email: 'jane@acme.com' } })
})

describe('DashboardPage', () => {
  it('shows the derived display name and role', () => {
    render(<DashboardPage />)
    expect(screen.getByText(/jane/)).toBeInTheDocument()
    expect(screen.getByText(/admin/)).toBeInTheDocument()
  })
})
