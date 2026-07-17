import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChangePasswordCard } from '@/components/account/change-password-card'
import { useAuthStore } from '@/lib/state-management/auth.store'

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', isLoading: false, error: null })
})

describe('ChangePasswordCard', () => {
  it('rejects a new password under 12 chars', async () => {
    const changePassword = vi.spyOn(useAuthStore.getState(), 'changePassword').mockResolvedValue()
    render(<ChangePasswordCard />)
    await userEvent.type(screen.getByLabelText(/current password/i), 'oldpassword12')
    await userEvent.type(screen.getByLabelText(/^new password/i), 'short')
    await userEvent.type(screen.getByLabelText(/confirm/i), 'short')
    await userEvent.click(screen.getByRole('button', { name: /change password/i }))
    expect(changePassword).not.toHaveBeenCalled()
    expect(await screen.findByText(/at least 12 characters/i)).toBeInTheDocument()
  })
})
