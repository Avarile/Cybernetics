import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginForm } from '@/components/login-form'
import { useAuthStore } from '@/lib/state-management/auth.store'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}))

beforeEach(() => {
  useAuthStore.setState({ status: 'idle', isLoading: false, error: null })
})

describe('LoginForm', () => {
  it('has no Google login button', () => {
    render(<LoginForm />)
    expect(screen.queryByText(/Google/i)).not.toBeInTheDocument()
  })
  it('validates email format before calling login', async () => {
    const login = vi.spyOn(useAuthStore.getState(), 'login').mockResolvedValue()
    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText(/email/i), 'not-an-email')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /login/i }))
    expect(login).not.toHaveBeenCalled()
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument()
  })
  it('calls login with valid credentials', async () => {
    const login = vi.spyOn(useAuthStore.getState(), 'login').mockResolvedValue()
    render(<LoginForm />)
    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /login/i }))
    expect(login).toHaveBeenCalledWith({ email: 'a@b.com', password: 'secret' })
  })
})
