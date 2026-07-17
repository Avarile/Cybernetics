import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AuthGuard } from '@/lib/auth/guards'
import { useAuthStore } from '@/lib/state-management/auth.store'

const replace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/dashboard',
}))

beforeEach(() => {
  replace.mockClear()
  useAuthStore.setState({ user: null, status: 'idle', isLoading: false, error: null })
})

describe('AuthGuard', () => {
  it('renders nothing while status is loading', () => {
    useAuthStore.setState({ status: 'loading' })
    const { container } = render(<AuthGuard><div>secret</div></AuthGuard>)
    expect(container.textContent).not.toContain('secret')
  })
  it('renders children when authenticated', () => {
    useAuthStore.setState({ status: 'authenticated', user: { id: 'u', role: 'user' } })
    render(<AuthGuard><div>secret</div></AuthGuard>)
    expect(screen.getByText('secret')).toBeInTheDocument()
  })
  it('redirects to login when unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated' })
    render(<AuthGuard><div>secret</div></AuthGuard>)
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('/auth/login'))
  })
})
