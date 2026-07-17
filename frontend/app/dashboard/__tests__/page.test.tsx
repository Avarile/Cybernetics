import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppSidebar } from '@/components/app-sidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuthStore } from '@/lib/state-management/auth.store'

// The dashboard page (shadcn block) delegates the user surface to AppSidebar →
// NavUser, which sources the logged-in user from the auth store. So the
// meaningful behaviour to cover is that the shell reflects the real user and
// that "Log out" clears the session.
function renderSidebar() {
  return render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>,
  )
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'u1', role: 'admin', email: 'jane@acme.com', displayName: 'Jane Doe' },
  })
})

describe('Dashboard shell', () => {
  it('shows the logged-in user (display name preferred, plus email)', () => {
    renderSidebar()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    expect(screen.getByText('jane@acme.com')).toBeInTheDocument()
  })

  it('falls back to the email local-part when there is no display name', () => {
    useAuthStore.setState({
      status: 'authenticated',
      user: { id: 'u1', role: 'admin', email: 'jane@acme.com' },
    })
    renderSidebar()
    expect(screen.getByText('jane')).toBeInTheDocument()
  })

  it('logs out when the "Log out" menu item is clicked', async () => {
    const logout = vi.spyOn(useAuthStore.getState(), 'logout').mockResolvedValue()
    const assign = vi.fn()
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    })

    try {
      renderSidebar()
      await userEvent.click(screen.getByRole('button', { name: /jane doe/i }))
      await userEvent.click(await screen.findByText('Log out'))

      expect(logout).toHaveBeenCalledOnce()
      expect(assign).toHaveBeenCalledWith('/auth/login')
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })
})
